import fs from "node:fs";
import OpenAI from "openai";
import type { Transcript } from "./types.js";

const MAX_BYTES = 25 * 1024 * 1024; // OpenAI upload limit

export async function transcribe(audioPath: string): Promise<Transcript> {
  if (fs.statSync(audioPath).size > MAX_BYTES) {
    throw new Error("Audio exceeds 25 MB (~100 min). Chunking is not implemented in the spike.");
  }
  const client = new OpenAI(); // reads OPENAI_API_KEY
  const res = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });
  return {
    duration: res.duration ?? 0,
    segments: (res.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })),
    words: (res.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
  };
}
