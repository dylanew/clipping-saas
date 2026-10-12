import { describe, expect, it } from "vitest";
import { findShots, planFraming, smooth, type Face, type Frame, type Segment } from "./framing.js";
import { layoutFilter } from "./render.js";

const FPS = 5;
const CROP_W = 0.316; // 9:16 window on a 16:9 frame
const grey = (v: number) => new Uint8Array(32 * 18).fill(v);
const face = (cx: number, mouth = 0.05): Face => ({ cx, cy: 0.4, w: 0.15, h: 0.3, mouth });
/** n frames at FPS; faces(i) gives the faces in frame i. */
const frames = (n: number, faces: (i: number) => Face[], thumb = (_i: number) => grey(100)): Frame[] =>
  Array.from({ length: n }, (_, i) => ({ t: i / FPS, faces: faces(i), thumb: thumb(i) }));
/** Mouth that opens and closes (talking) or stays still. */
const talking = (i: number) => (i % 2 ? 0.02 : 0.12);
const kinds = (plan: Segment[]) => plan.map((s) => (s.layout.kind === "crop" ? `crop@${s.layout.cx.toFixed(2)}` : s.layout.kind));

describe("findShots", () => {
  it("finds a hard cut", () => {
    expect(findShots(frames(10, () => [], (i) => grey(i < 6 ? 40 : 200)))).toEqual([0, 6]);
  });
});

describe("planFraming", () => {
  it("falls back to fit when there are no faces", () => {
    expect(kinds(planFraming(frames(20, () => []), 4, CROP_W, FPS))).toEqual(["fit"]);
  });

  it("follows a single face", () => {
    expect(kinds(planFraming(frames(20, () => [face(0.7)]), 4, CROP_W, FPS))).toEqual(["crop@0.70"]);
  });

  it("frames two people together when they fit in one window", () => {
    expect(kinds(planFraming(frames(20, () => [face(0.45), face(0.55)]), 4, CROP_W, FPS))).toEqual(["crop@0.50"]);
  });

  it("follows whoever is talking in a wide two-shot", () => {
    // Left talks for 4s, then right talks for 4s.
    const f = frames(40, (i) => (i < 20 ? [face(0.25, talking(i)), face(0.75)] : [face(0.25), face(0.75, talking(i))]));
    const plan = planFraming(f, 8, CROP_W, FPS);
    expect(kinds(plan)).toEqual(["crop@0.25", "crop@0.75"]);
    expect(plan[1].start).toBeGreaterThan(3.4);
    expect(plan[1].start).toBeLessThan(4.6);
  });

  it("stacks both people when nobody is clearly talking for a while", () => {
    expect(kinds(planFraming(frames(25, () => [face(0.25), face(0.75)]), 5, CROP_W, FPS))).toEqual(["split"]);
  });

  it("plans each shot separately across a cut", () => {
    const f = frames(20, (i) => (i < 10 ? [face(0.3)] : []), (i) => grey(i < 10 ? 40 : 200));
    const plan = planFraming(f, 4, CROP_W, FPS);
    expect(kinds(plan)).toEqual(["crop@0.30", "fit"]);
    expect(plan[1].start).toBeCloseTo(1.9);
  });
});

describe("smooth", () => {
  it("absorbs a framing change shorter than the minimum", () => {
    const crop = (cx: number) => ({ kind: "crop" as const, cx });
    const out = smooth([
      { start: 0, end: 3, layout: crop(0.2) },
      { start: 3, end: 3.5, layout: crop(0.8) },
      { start: 3.5, end: 6, layout: crop(0.2) },
    ]);
    expect(out).toEqual([{ start: 0, end: 6, layout: crop(0.2) }]);
  });
});

describe("layoutFilter", () => {
  it("keeps the crop window inside the frame", () => {
    expect(layoutFilter({ kind: "crop", cx: 0.99 }, 1920, 1080)).toBe("crop=608:1080:1312:0,scale=1080:1920,setsar=1");
    expect(layoutFilter({ kind: "crop", cx: 0 }, 1920, 1080)).toMatch(/^crop=608:1080:0:0,/);
  });
  it("handles a source that is already vertical", () => {
    expect(layoutFilter({ kind: "crop", cx: 0.5 }, 1080, 1920)).toMatch(/^crop=1080:1920:0:0,/);
  });
});
