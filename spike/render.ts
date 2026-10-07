import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

/**
 * Cut one clip: centre-crop to 9:16 at 1080x1920 and burn in captions.
 * Centre crop is a placeholder until we add speaker/face tracking.
 */
export async function renderClip(videoPath: string, words: Word[], clip: Clip, index: number, outDir: string): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${String(index).padStart(2, "0")}_${slug(clip.title)}`);
  const assPath = `${base}.ass`;
  fs.writeFileSync(assPath, buildCaptions(words, clip));
  // The ass filter takes a filter-graph argument, so escape characters it treats specially.
  const assArg = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  await ffmpeg([
    "-y", "-ss", clip.start.toFixed(2), "-to", clip.end.toFixed(2), "-i", videoPath,
    "-vf", `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,ass=${assArg}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    `${base}.mp4`,
  ]);
  return `${base}.mp4`;
}
