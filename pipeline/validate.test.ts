import { describe, expect, it } from "vitest";
import { cleanClips, sentenceEnds, type Clip } from "./validate.js";
import type { Transcript } from "./types.js";

// 200 one-second words: word i spans [i, i+1]
const words = Array.from({ length: 200 }, (_, i) => ({ word: `w${i}`, start: i, end: i + 1 }));
const t: Transcript = { duration: 200, segments: [], words };
const clip = (start: number, end: number, score = 0.5): Clip => ({ start, end, score, title: "t", reason: "r" });

describe("cleanClips", () => {
  it("snaps to word boundaries", () => {
    const [c] = cleanClips([clip(10.4, 40.6)], t);
    expect(c.start).toBe(10);
    expect(c.end).toBe(41);
  });
  it("drops clips outside the length limits", () => {
    expect(cleanClips([clip(0, 5), clip(0, 150)], t)).toHaveLength(0);
  });
  it("drops clips beyond the video duration", () => {
    expect(cleanClips([clip(190, 260)], t)).toHaveLength(0);
  });
  it("drops overlapping clips, keeping the higher score", () => {
    const res = cleanClips([clip(10, 50, 0.6), clip(30, 70, 0.9)], t);
    expect(res).toHaveLength(1);
    expect(res[0].score).toBe(0.9);
  });
  it("sorts best first", () => {
    const res = cleanClips([clip(10, 40, 0.3), clip(100, 130, 0.8)], t);
    expect(res.map((c) => c.score)).toEqual([0.8, 0.3]);
  });
});

/** Transcript of one-second words split into sentences of the given lengths, one segment per sentence. */
function sentences(lengths: number[], gapAfter: number[] = []): Transcript {
  const ws: Transcript["words"] = [];
  const segs: Transcript["segments"] = [];
  let t0 = 0;
  for (const [n, len] of lengths.entries()) {
    const first = ws.length;
    for (let k = 0; k < len; k++) { ws.push({ word: `w${ws.length}`, start: t0, end: t0 + 1 }); t0 += 1; }
    if (gapAfter.includes(n)) t0 += 2;
    segs.push({ start: ws[first].start, end: ws[ws.length - 1].end, text: ws.slice(first).map((w) => w.word).join(" ") + "." });
  }
  return { duration: t0, segments: segs, words: ws };
}

describe("sentence boundaries", () => {
  it("reads sentence ends from segment punctuation", () => {
    const ends = sentenceEnds(sentences([3, 2]));
    expect(ends).toEqual([false, false, true, false, true]);
  });
  it("uses only the segment's last word when tokens and words don't line up", () => {
    const tr = sentences([4, 2]);
    tr.segments[0].text = "Well. Hello there friend, how are you?"; // 7 tokens for 4 words
    expect(sentenceEnds(tr)).toEqual([false, false, false, true, false, true]);
  });
  it("treats a long pause as the end of a thought", () => {
    const tr: Transcript = { duration: 10, segments: [], words: [
      { word: "a", start: 0, end: 1 }, { word: "b", start: 2, end: 3 }, { word: "c", start: 3, end: 4 },
    ] };
    expect(sentenceEnds(tr)).toEqual([true, false, true]);
  });
  it("starts at the beginning of the sentence and ends when the sentence finishes", () => {
    // sentences cover words 0-11, 12-23, 24-37, 38-45, 46-59
    const tr = sentences([12, 12, 14, 8, 14]);
    const [c] = cleanClips([clip(14.5, 40.2)], tr);
    expect(c.start).toBe(12); // back to the start of "w12 ..."
    expect(c.end).toBe(46); // on to the end of the sentence that was cut off
  });
  it("leaves a short tail after the last word when there is silence", () => {
    const tr = sentences([10, 20, 10], [1]); // 2s of silence after the second sentence
    const [c] = cleanClips([clip(10, 29.5)], tr);
    expect(c.end).toBeCloseTo(30.35);
  });
  it("falls back to the nearest word when no boundary is close", () => {
    const tr = sentences([100]);
    const [c] = cleanClips([clip(40.4, 70.6)], tr);
    expect([c.start, c.end]).toEqual([40, 71]);
  });
});
