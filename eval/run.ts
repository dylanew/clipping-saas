/**
 * Batch test: runs the clip pipeline over several videos and writes a scorecard to fill in by hand.
 *
 *   npm run eval -- <videos or folders...> [--redo] [--same-picks] [--no-render] [--centre]
 *
 * Outputs (eval/out/, git-ignored):
 *   <video>/            transcript, clip suggestions and rendered clips for that video
 *   scorecard.csv       one row per clip; fill in post_it, clean_start, clean_end, framing_ok, notes
 *   runs.csv            one row per video: timings, token counts, estimated cost, errors
 * Videos that already ran fine are skipped (so you can add more later) unless --redo is passed;
 * failed ones are tried again. With --same-picks, a redo reuses Claude's saved picks instead of asking
 * again, so only the cutting and rendering change between runs (and it costs nothing).
 * Then run `npm run eval:report` for the summary.
 */
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { extractAudio } from "../pipeline/audio.js";
import { transcribe } from "../pipeline/transcribe.js";
import { suggestClips } from "../pipeline/analyse.js";
import { renderClip } from "../pipeline/render.js";
import { cleanClips, type Clip } from "../pipeline/validate.js";
import type { ClipUsage } from "../pipeline/analyse.js";
import type { Transcript } from "../pipeline/types.js";
import { parseCsv, toCsv, type Row } from "./csv.js";
import { claudeCost, RUNS_COLUMNS, SCORECARD_COLUMNS, WHISPER_USD_PER_MIN } from "./score.js";

config({ path: ".env.local" });

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm"]);
const OUT = path.resolve(process.env.EVAL_DIR ?? "eval/out");
const SCORECARD = path.join(OUT, "scorecard.csv");
const RUNS = path.join(OUT, "runs.csv");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const inputs = args.filter((a) => !a.startsWith("--"));
if (inputs.length === 0) {
  console.error("Usage: npm run eval -- <videos or folders...> [--redo] [--same-picks] [--no-render] [--centre]");
  process.exit(1);
}

const videos = inputs.flatMap((p) =>
  fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase())).sort().map((f) => path.join(p, f))
    : [p],
);

const read = (file: string): Row[] => (fs.existsSync(file) ? parseCsv(fs.readFileSync(file, "utf8")) : []);
fs.mkdirSync(OUT, { recursive: true });
let scorecard = read(SCORECARD);
let runs = read(RUNS);

const seconds = (since: number) => ((Date.now() - since) / 1000).toFixed(1);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

for (const [n, video] of videos.entries()) {
  const name = path.parse(video).name;
  const tag = `[${n + 1}/${videos.length}] ${name}`;
  if (!flags.has("--redo") && runs.some((r) => r.video === name && !r.error)) {
    console.log(`${tag}: already done, skipping (pass --redo to run it again)`);
    continue;
  }
  if (flags.has("--redo") && scorecard.some((r) => r.video === name && (r.post_it || r.notes))) {
    console.log(`${tag}: --redo replaces this video's rows in scorecard.csv, including your ratings`);
  }

  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, "transcript.json");
  const run: Row = { video: name };
  const rows: Row[] = [];

  try {
    let transcript: Transcript;
    if (fs.existsSync(transcriptPath)) {
      transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
      run.transcript_cached = "yes";
    } else {
      console.log(`${tag}: transcribing...`);
      const t0 = Date.now();
      const audio = path.join(dir, "audio.mp3");
      await extractAudio(video, audio);
      transcript = await transcribe(audio);
      fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
      run.transcribe_s = seconds(t0);
      run.transcript_cached = "no";
    }
    const minutes = transcript.duration / 60;
    run.minutes = minutes.toFixed(1);
    run.whisper_usd = (minutes * WHISPER_USD_PER_MIN).toFixed(4); // what a fresh run costs, cached or not

    const picksPath = path.join(dir, "clips.json");
    let raw: Clip[], clips: Clip[], usage: ClipUsage;
    if (flags.has("--same-picks") && fs.existsSync(picksPath)) {
      // Reuse the saved picks but clean them with the current rules; usage is from the original call.
      ({ raw, usage } = JSON.parse(fs.readFileSync(picksPath, "utf8")));
      clips = cleanClips(raw, transcript);
      console.log(`${tag}: reusing saved picks`);
    } else {
      console.log(`${tag}: finding clips...`);
      const t1 = Date.now();
      ({ raw, clips, usage } = await suggestClips(transcript));
      run.analyse_s = seconds(t1);
    }
    fs.writeFileSync(picksPath, JSON.stringify({ raw, clips, usage }, null, 2));
    run.claude_model = usage.model;
    run.claude_in_tokens = String(usage.inputTokens);
    run.claude_out_tokens = String(usage.outputTokens);
    run.claude_usd = claudeCost(usage.model, usage.inputTokens, usage.outputTokens)?.toFixed(4) ?? "";
    run.clips_proposed = String(raw.length);
    run.clips_kept = String(clips.length);

    const t2 = Date.now();
    fs.rmSync(path.join(dir, "clips"), { recursive: true, force: true }); // clear the last run's renders
    for (const [i, c] of clips.entries()) {
      let file = "";
      if (!flags.has("--no-render")) {
        console.log(`${tag}: rendering clip ${i + 1}/${clips.length}...`);
        file = path.relative(OUT, await renderClip(video, transcript.words, c, i + 1, path.join(dir, "clips"), { framing: !flags.has("--centre") }));
      }
      rows.push({
        video: name, clip: String(i + 1), file,
        start: c.start.toFixed(1), end: c.end.toFixed(1), seconds: (c.end - c.start).toFixed(0),
        ai_score: c.score.toFixed(2), title: c.title,
      });
    }
    if (!flags.has("--no-render")) run.render_s = seconds(t2);
    console.log(`${tag}: done, ${clips.length} clips`);
  } catch (e) {
    run.error = message(e);
    console.error(`${tag}: failed: ${run.error}`);
  }

  // Save after every video so a crash or Ctrl-C keeps what's finished.
  runs = [...runs.filter((r) => r.video !== name), run];
  scorecard = [...scorecard.filter((r) => r.video !== name), ...rows];
  fs.writeFileSync(RUNS, toCsv(RUNS_COLUMNS, runs));
  fs.writeFileSync(SCORECARD, toCsv(SCORECARD_COLUMNS, scorecard));
}

console.log(`\nScorecard: ${SCORECARD}`);
console.log("Watch each clip, fill in post_it, clean_start, clean_end, framing_ok (y/n) and notes, then run: npm run eval:report");
