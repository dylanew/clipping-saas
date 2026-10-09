import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { analyseFaces, probeSize, SAMPLE_FPS } from "./faces.js";
import { planFraming, type Layout, type Segment } from "./framing.js";
import type { Word } from "./types.js";
import type { Clip } from "./validate.js";

const WORDS_PER_CAPTION = 3;

/** Format seconds as an ASS timestamp (H:MM:SS.cc). */
function assTime(sec: number): string {
  const cs = Math.round(Math.max(0, sec) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/**
 * Burned-in captions as an ASS subtitle file: a few words at a time, big and
 * centred in the lower third of a 1080x1920 frame. Times are relative to the clip start.
 */
export function buildCaptions(words: Word[], clip: Pick<Clip, "start" | "end">): string {
  const inClip = words.filter((w) => w.start >= clip.start && w.start < clip.end);
  const lines: string[] = [];
  for (let i = 0; i < inClip.length; i += WORDS_PER_CAPTION) {
    const chunk = inClip.slice(i, i + WORDS_PER_CAPTION);
    const next = inClip[i + WORDS_PER_CAPTION];
    const start = chunk[0].start - clip.start;
    const lastEnd = chunk[chunk.length - 1].end - clip.start;
    // Hold the caption until the next one starts (max 0.5s gap) so it doesn't flicker.
    const end = next ? Math.max(lastEnd, Math.min(next.start - clip.start, lastEnd + 0.5)) : lastEnd;
    const text = chunk.map((w) => w.word.trim()).join(" ").toUpperCase().replace(/[{}\\]/g, "");
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "clip";
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`)),
    );
  });
}

const OUT_W = 1080;
const OUT_H = 1920;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** ffmpeg filter that turns a W x H source frame into a 1080x1920 frame for one layout. */
export function layoutFilter(layout: Layout, W: number, H: number): string {
  if (layout.kind === "crop") {
    const cw = even(Math.min(W, (H * 9) / 16));
    const ch = even(Math.min(H, (W * 16) / 9));
    const x = Math.round(clamp(layout.cx * W - cw / 2, 0, W - cw));
    const y = Math.round((H - ch) / 2);
    return `crop=${cw}:${ch}:${x}:${y},scale=${OUT_W}:${OUT_H},setsar=1`;
  }
  if (layout.kind === "split") {
    // Each speaker gets a 1080x960 tile (9:8), zoomed so the head fills about 40% of the tile height.
    const tile = (t: { cx: number; cy: number; h: number }) => {
      let th = even(clamp(t.h * H * 2.5, H * 0.3, H));
      let tw = even((th * 9) / 8);
      if (tw > W) { tw = even(W); th = even((tw * 8) / 9); }
      const x = Math.round(clamp(t.cx * W - tw / 2, 0, W - tw));
      const y = Math.round(clamp(t.cy * H - th * 0.45, 0, H - th));
      return `crop=${tw}:${th}:${x}:${y},scale=${OUT_W}:${OUT_H / 2}`;
    };
    return `split[a][b];[a]${tile(layout.top)}[a1];[b]${tile(layout.bottom)}[b1];[a1][b1]vstack,setsar=1`;
  }
  return `split[a][b];[a]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},boxblur=20:2[bg];` +
    `[b]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
}

/**
 * Cut one clip to 1080x1920 with burned-in captions.
 * With framing on, faces decide the layout of each part of the clip (follow the speaker,
 * stack two speakers, or fit the whole frame); otherwise it is a plain centre crop.
 */
export async function renderClip(
  videoPath: string, words: Word[], clip: Clip, index: number, outDir: string, opts: { framing: boolean } = { framing: true },
): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${String(index).padStart(2, "0")}_${slug(clip.title)}`);
  const duration = clip.end - clip.start;
  const src = await probeSize(videoPath);

  let plan: Segment[] = [{ start: 0, end: duration, layout: { kind: "crop", cx: 0.5 } }];
  if (opts.framing) {
    const frames = await analyseFaces(videoPath, clip.start, clip.end, src);
    plan = planFraming(frames, duration, Math.min(1, (src.height * 9) / 16 / src.width), SAMPLE_FPS);
  }
  fs.writeFileSync(`${base}.framing.json`, JSON.stringify(plan, (k, v) => (k === "mouth" ? undefined : v), 2));

  // Render each part with its own layout, then join them and add captions and the original audio in one pass.
  const parts: string[] = [];
  for (const [k, seg] of plan.entries()) {
    const part = `${base}.part${k}.mp4`;
    await ffmpeg([
      "-y", "-ss", (clip.start + seg.start).toFixed(3), "-to", (clip.start + seg.end).toFixed(3), "-i", videoPath,
      "-vf", layoutFilter(seg.layout, src.width, src.height), "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", part,
    ]);
    parts.push(part);
  }
  const list = `${base}.parts.txt`;
  fs.writeFileSync(list, parts.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n"));

  const assPath = `${base}.ass`;
  fs.writeFileSync(assPath, buildCaptions(words, clip));
  // The ass filter takes a filter-graph argument, so escape characters it treats specially.
  const assArg = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  try {
    await ffmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", list,
      "-ss", clip.start.toFixed(3), "-to", clip.end.toFixed(3), "-i", videoPath,
      "-map", "0:v", "-map", "1:a:0?", "-vf", `ass=${assArg}`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
      `${base}.mp4`,
    ]);
  } finally {
    for (const p of [...parts, list]) fs.rmSync(p, { force: true });
  }
  return `${base}.mp4`;
}
