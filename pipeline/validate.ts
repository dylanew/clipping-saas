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

/** Move start to the nearest word start and end to the nearest word end, so we never cut mid-word. */
function snap(clip: Clip, t: Transcript): Clip {
  if (t.words.length === 0) return clip;
  const nearest = (target: number, key: "start" | "end") =>
    t.words.reduce((best, w) => (Math.abs(w[key] - target) < Math.abs(best[key] - target) ? w : best))[key];
  return { ...clip, start: nearest(clip.start, "start"), end: nearest(clip.end, "end") };
}

/**
 * Never trust LLM output: snap to words, drop impossible clips,
 * drop overlaps (keeping the higher score), sort best-first.
 */
export function cleanClips(clips: Clip[], t: Transcript, rules: ClipRules = DEFAULT_RULES): Clip[] {
  const valid = clips
    .map((c) => snap(c, t))
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
