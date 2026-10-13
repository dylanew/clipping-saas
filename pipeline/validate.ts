import { z } from "zod";
import type { Transcript } from "./types.js";

/** What we ask the LLM to return. */
export const ClipSchema = z.object({
  start: z.number().describe("Start time in seconds"),
  end: z.number().describe("End time in seconds"),
  title: z.string().describe("Punchy title, max 70 chars"),
  reason: z.string().describe("Why this works as a standalone short"),
  score: z.number().min(0).max(1).describe("Confidence this will perform well, 0-1"),
});
export const ClipsResponseSchema = z.object({ clips: z.array(ClipSchema) });
export type Clip = z.infer<typeof ClipSchema>;

export interface ClipRules { minSeconds: number; maxSeconds: number }
export const DEFAULT_RULES: ClipRules = { minSeconds: 15, maxSeconds: 90 };

const SENTENCE_END = /[.!?…]["')\]]*$/;
const PAUSE = 0.7; // a silence this long (seconds) also counts as the end of a thought
const LOOK_BACK = 5; // how far a cut may move to reach a sentence boundary
const LOOK_AHEAD = 6;
const TAIL = 0.35; // keep a moment after the last word so it doesn't sound clipped

/**
 * For each word, whether it ends a sentence. Whisper's words carry no punctuation, so it comes from
 * the segment text: when a segment has as many tokens as words, each word gets its token's punctuation;
 * otherwise only the segment's last word does. A long pause after a word also ends a sentence.
 */
export function sentenceEnds(t: Transcript): boolean[] {
  const ends = t.words.map((w, i) => {
    const next = t.words[i + 1];
    return !next || next.start - w.end >= PAUSE || SENTENCE_END.test(w.word.trim());
  });
  let i = 0;
  for (const seg of t.segments) {
    const first = i;
    while (i < t.words.length && (t.words[i].start + t.words[i].end) / 2 < seg.end) i++;
    const inSeg = i - first;
    if (inSeg === 0) continue;
    const tokens = seg.text.trim().split(/\s+/);
    if (tokens.length === inSeg) tokens.forEach((tok, k) => { if (SENTENCE_END.test(tok)) ends[first + k] = true; });
    else if (SENTENCE_END.test(seg.text.trim())) ends[i - 1] = true;
  }
  return ends;
}

/**
 * Move the cut points to sentence boundaries near the model's times: start at the beginning of the
 * sentence it lands in (or the next one if that's closer), and end after the sentence it lands in
 * finishes (or the previous one if the next is too far). Falls back to the nearest word.
 */
function snap(clip: Clip, t: Transcript, ends: boolean[]): Clip {
  const w = t.words;
  if (w.length === 0) return clip;
  const nearestWord = (target: number, key: "start" | "end") =>
    w.reduce((best, x, i) => (Math.abs(x[key] - target) < Math.abs(w[best][key] - target) ? i : best), 0);
  const isStart = (i: number) => i === 0 || ends[i - 1];

  const s0 = nearestWord(clip.start, "start");
  let s = -1;
  for (let i = s0; i >= 0 && clip.start - w[i].start <= LOOK_BACK; i--) if (isStart(i)) { s = i; break; }
  if (s < 0) for (let i = s0 + 1; i < w.length && w[i].start - clip.start <= LOOK_AHEAD / 2; i++) if (isStart(i)) { s = i; break; }
  if (s < 0) s = s0;

  const e0 = nearestWord(clip.end, "end");
  let e = -1;
  for (let i = e0; i < w.length && w[i].end - clip.end <= LOOK_AHEAD; i++) if (ends[i]) { e = i; break; }
  if (e < 0) for (let i = e0 - 1; i > s && clip.end - w[i].end <= LOOK_BACK; i--) if (ends[i]) { e = i; break; }
  if (e < 0 || e < s) e = Math.max(e0, s);

  const prevEnd = s > 0 ? w[s - 1].end : 0;
  const nextStart = e + 1 < w.length ? w[e + 1].start : t.duration;
  return {
    ...clip,
    start: Math.max(prevEnd, w[s].start - 0.1, 0),
    end: Math.max(w[e].end, Math.min(w[e].end + TAIL, nextStart, t.duration || Infinity)),
  };
}

/**
 * Never trust LLM output: snap to sentence boundaries, drop impossible clips,
 * drop overlaps (keeping the higher score), sort best-first.
 */
export function cleanClips(clips: Clip[], t: Transcript, rules: ClipRules = DEFAULT_RULES): Clip[] {
  const ends = sentenceEnds(t);
  const valid = clips
    .map((c) => snap(c, t, ends))
    .filter((c) => {
      const len = c.end - c.start;
      return c.start >= 0 && c.end <= t.duration + 1 && len >= rules.minSeconds && len <= rules.maxSeconds;
    })
    .sort((a, b) => b.score - a.score);

  const kept: Clip[] = [];
  for (const c of valid) {
    if (!kept.some((k) => c.start < k.end && k.start < c.end)) kept.push(c);
  }
  return kept;
}
