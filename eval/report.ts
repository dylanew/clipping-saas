/**
 * Summarises the filled-in scorecard: `npm run eval:report`.
 * Prints the summary and saves it to eval/out/report.md.
 */
import fs from "node:fs";
import path from "node:path";
import { parseCsv, type Row } from "./csv.js";
import { pct, SCORE_COLUMNS, summarise, totalRuns, type Summary } from "./score.js";

const OUT = path.resolve(process.env.EVAL_DIR ?? "eval/out");
const read = (file: string): Row[] => {
  const p = path.join(OUT, file);
  return fs.existsSync(p) ? parseCsv(fs.readFileSync(p, "utf8")) : [];
};
const scorecard = read("scorecard.csv");
const runs = read("runs.csv");
if (scorecard.length === 0 && runs.length === 0) {
  console.error(`Nothing in ${OUT} yet. Run: npm run eval -- <videos>`);
  process.exit(1);
}

const LABELS: Record<(typeof SCORE_COLUMNS)[number], string> = {
  post_it: "Would post",
  clean_start: "Clean start",
  clean_end: "Clean end",
  framing_ok: "Framing OK",
};
const row = (name: string, s: Summary) => `| ${name} | ${s.clips} | ${SCORE_COLUMNS.map((c) => pct(s.rates[c])).join(" | ")} |`;

const lines: string[] = ["# Clip quality test", ""];
lines.push(`| Video | Clips | ${SCORE_COLUMNS.map((c) => LABELS[c]).join(" | ")} |`);
lines.push(`|---|---|${SCORE_COLUMNS.map(() => "---").join("|")}|`);
const names = [...new Set(scorecard.map((r) => r.video))];
for (const v of names) lines.push(row(v, summarise(scorecard.filter((r) => r.video === v))));
lines.push(row("**All**", summarise(scorecard)));

const t = totalRuns(runs);
const spm = (v?: number) => (v === undefined ? "-" : `${v.toFixed(1)}s`);
lines.push("", "## Time and cost", "");
lines.push(`- Videos processed: ${t.videos}${t.failed ? `, failed: ${t.failed}` : ""}, ${t.minutes.toFixed(0)} minutes in total`);
lines.push(`- Estimated API cost: $${t.usd.toFixed(2)}${t.minutes > 0 ? `, about $${((t.usd / t.minutes) * 60).toFixed(2)} per hour of video` : ""}`);
lines.push(
  `- Processing per minute of video: transcribe ${spm(t.secondsPerMinute.transcribe)}, ` +
    `pick clips ${spm(t.secondsPerMinute.analyse)}, render ${spm(t.secondsPerMinute.render)}`,
);
for (const r of runs.filter((r) => r.error)) lines.push(`- Failed: ${r.video}: ${r.error}`);

const notes = scorecard.filter((r) => r.notes);
if (notes.length > 0) {
  lines.push("", "## Notes", "");
  for (const r of notes) lines.push(`- ${r.video} #${r.clip} (${r.title}): ${r.notes}`);
}

const report = lines.join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "report.md"), report);
console.log(report);
console.log(`Saved to ${path.join(OUT, "report.md")}`);
