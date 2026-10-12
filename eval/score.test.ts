import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv.js";
import { claudeCost, summarise, totalRuns, yesNo } from "./score.js";

describe("csv", () => {
  it("round-trips commas, quotes and newlines", () => {
    const rows = [{ title: 'He said "no", then left', notes: "line one\nline two" }];
    expect(parseCsv(toCsv(["title", "notes"], rows))).toEqual(rows);
  });

  it("reads files saved by spreadsheet apps (BOM, CRLF, blank lines)", () => {
    expect(parseCsv("﻿video,post_it\r\na, Y \r\n\r\n")).toEqual([{ video: "a", post_it: "Y" }]);
  });
});

describe("scoring", () => {
  it("accepts common yes/no spellings and leaves blanks unrated", () => {
    expect([yesNo("Yes"), yesNo("n"), yesNo("✓"), yesNo(""), yesNo("maybe")]).toEqual([true, false, true, undefined, undefined]);
  });

  it("counts only rated clips in each rate", () => {
    const s = summarise([{ post_it: "y", framing_ok: "n" }, { post_it: "n" }, { post_it: "" }]);
    expect(s.clips).toBe(3);
    expect(s.rates.post_it).toEqual({ yes: 1, rated: 2 });
    expect(s.rates.framing_ok).toEqual({ yes: 0, rated: 1 });
    expect(s.rates.clean_end).toEqual({ yes: 0, rated: 0 });
  });

  it("prices Claude calls and skips unknown models", () => {
    expect(claudeCost("claude-sonnet-5-5", 1_000_000, 100_000)).toBeCloseTo(3);
    expect(claudeCost("some-other-model", 1, 1)).toBeUndefined();
  });

  it("totals cost and time per minute, ignoring failed videos and untimed stages", () => {
    const t = totalRuns([
      { video: "a", minutes: "60", whisper_usd: "0.36", claude_usd: "0.10", transcribe_s: "120", analyse_s: "30", render_s: "" },
      { video: "b", minutes: "30", whisper_usd: "0.18", claude_usd: "0.05", analyse_s: "15" },
      { video: "c", error: "boom" },
    ]);
    expect(t).toMatchObject({ videos: 2, failed: 1, minutes: 90 });
    expect(t.usd).toBeCloseTo(0.69);
    expect(t.secondsPerMinute.transcribe).toBeCloseTo(2);
    expect(t.secondsPerMinute.analyse).toBeCloseTo(0.5);
    expect(t.secondsPerMinute.render).toBeUndefined();
  });
});
