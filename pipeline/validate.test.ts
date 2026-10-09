import { describe, expect, it } from "vitest";
import { cleanClips, type Clip } from "./validate.js";
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
