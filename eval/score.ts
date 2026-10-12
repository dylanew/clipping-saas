/**
 * Turns the hand-filled scorecard (one row per clip) and the run log (one row per video)
 * into the numbers we care about: how many clips are worth posting, how clean the cuts are,
 * how often framing is right, and what a video costs in time and money.
 */
import type { Row } from "./csv.js";

export const SCORE_COLUMNS = ["post_it", "clean_start", "clean_end", "framing_ok"] as const;
export type ScoreColumn = (typeof SCORE_COLUMNS)[number];

export const SCORECARD_COLUMNS = [
  "video", "clip", "file", "start", "end", "seconds", "ai_score", "title", ...SCORE_COLUMNS, "notes",
];
export const RUNS_COLUMNS = [
  "video", "minutes", "transcript_cached", "transcribe_s", "analyse_s", "render_s",
  "whisper_usd", "claude_model", "claude_in_tokens", "claude_out_tokens", "claude_usd",
  "clips_proposed", "clips_kept", "error",
];

// Assumed prices, USD. Whisper is billed per minute of audio; Claude per million tokens.
export const WHISPER_USD_PER_MIN = 0.006;
export const CLAUDE_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export function claudeCost(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const p = CLAUDE_USD_PER_MTOK[model];
  return p && (inputTokens * p.input + outputTokens * p.output) / 1e6;
}

/** "y", "yes", "1", "✓" count as yes; "n", "no", "0", "x" as no; anything else is not rated yet. */
export function yesNo(v: string | undefined): boolean | undefined {
  const s = (v ?? "").trim().toLowerCase();
  if (["y", "yes", "1", "true", "✓", "✔"].includes(s)) return true;
  if (["n", "no", "0", "false", "x", "✗"].includes(s)) return false;
  return undefined;
}

export interface Rate { yes: number; rated: number }
export interface Summary {
  clips: number;
  rates: Record<ScoreColumn, Rate>;
}

export function summarise(rows: Row[]): Summary {
  const rates = Object.fromEntries(SCORE_COLUMNS.map((c) => [c, { yes: 0, rated: 0 }])) as Record<ScoreColumn, Rate>;
  for (const r of rows) {
    for (const c of SCORE_COLUMNS) {
      const v = yesNo(r[c]);
      if (v === undefined) continue;
      rates[c].rated++;
      if (v) rates[c].yes++;
    }
  }
  return { clips: rows.length, rates };
}

export function pct(r: Rate): string {
  return r.rated === 0 ? "-" : `${Math.round((100 * r.yes) / r.rated)}% (${r.yes}/${r.rated})`;
}

const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

export interface RunTotals {
  videos: number;
  failed: number;
  minutes: number;
  usd: number;
  /** Seconds of processing per minute of source video, for the stages that actually ran. */
  secondsPerMinute: { transcribe?: number; analyse?: number; render?: number };
}

export function totalRuns(runs: Row[]): RunTotals {
  const ok = runs.filter((r) => !r.error);
  const minutes = ok.reduce((s, r) => s + (num(r.minutes) ?? 0), 0);
  const usd = ok.reduce((s, r) => s + (num(r.whisper_usd) ?? 0) + (num(r.claude_usd) ?? 0), 0);
  const perMin = (col: string) => {
    const timed = ok.filter((r) => num(r[col]) !== undefined);
    const mins = timed.reduce((s, r) => s + (num(r.minutes) ?? 0), 0);
    return mins > 0 ? timed.reduce((s, r) => s + (num(r[col]) ?? 0), 0) / mins : undefined;
  };
  return {
    videos: ok.length,
    failed: runs.length - ok.length,
    minutes,
    usd,
    secondsPerMinute: { transcribe: perMin("transcribe_s"), analyse: perMin("analyse_s"), render: perMin("render_s") },
  };
}
