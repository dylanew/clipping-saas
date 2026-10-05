import "dotenv/config";
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { extractAudio } from "./audio.js";
import { transcribe } from "./transcribe.js";
import { suggestClips } from "./analyse.js";
import type { Transcript } from "./types.js";

config({ path: ".env.local" });

const [input, ...flags] = process.argv.slice(2);
if (!input) {
  console.error("Usage: npm run spike -- <video-file> [--refresh]");
  process.exit(1);
}
const refresh = flags.includes("--refresh");
const name = path.parse(input).name;
const out = path.resolve("spike/out");
fs.mkdirSync(out, { recursive: true });
const audioPath = path.join(out, `${name}.mp3`);
const transcriptPath = path.join(out, `${name}.transcript.json`);

let transcript: Transcript;
if (!refresh && fs.existsSync(transcriptPath)) {
  console.log(`Using cached transcript (${transcriptPath}). Pass --refresh to redo.`);
  transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
} else {
  console.log("1/3 Extracting audio...");
  await extractAudio(input, audioPath);
  console.log("2/3 Transcribing...");
  transcript = await transcribe(audioPath);
  fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
}

console.log("3/3 Finding clips...");
const { raw, clips } = await suggestClips(transcript);
fs.writeFileSync(path.join(out, `${name}.clips.json`), JSON.stringify({ raw, clips }, null, 2));

console.log(`\nModel proposed ${raw.length} clips; ${clips.length} passed validation:\n`);
for (const c of clips) {
  console.log(`[${c.score.toFixed(2)}] ${c.start.toFixed(1)}s-${c.end.toFixed(1)}s (${(c.end - c.start).toFixed(0)}s)  ${c.title}\n       ${c.reason}\n`);
}
