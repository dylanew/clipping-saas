/**
 * Decide how to frame each moment of a clip in 9:16, from the faces found in sampled frames.
 * Pure functions only (no ffmpeg / ML), so the rules are easy to test and tune.
 */

/** A face in one frame. Positions and sizes are fractions of the frame (0-1). */
export interface Face { cx: number; cy: number; w: number; h: number; mouth: number }
/** One sampled frame: time from clip start, faces, and a tiny greyscale thumbnail for cut detection. */
export interface Frame { t: number; faces: Face[]; thumb: Uint8Array }

/** A face followed through one shot. */
export interface Track { cx: number; cy: number; h: number; presence: number; mouth: (number | null)[] }

export type Layout =
  | { kind: "crop"; cx: number } // 9:16 window centred on cx (full height)
  | { kind: "split"; top: Track; bottom: Track } // two speakers stacked
  | { kind: "fit" }; // whole frame over a blurred copy (no usable face)

export interface Segment { start: number; end: number; layout: Layout }

export const RULES = {
  cutThreshold: 28, // mean greyscale difference (0-255) between thumbnails that counts as a camera cut
  matchDistance: 0.1, // faces this close (fraction of width) in consecutive frames are the same person
  minPresence: 0.4, // a track must be visible in this share of a shot's frames to count
  activityWindow: 1.2, // seconds of mouth movement averaged to decide who is talking
  minActivity: 0.006, // below this nobody is clearly talking
  dominance: 1.4, // the talker must move their mouth this many times more than the other person
  minSegment: 1.5, // never switch framing for less than this many seconds
  unclearToSplit: 3, // seconds without a clear talker before showing both people
};

/** Indices where a new shot starts (always includes 0). */
export function findShots(frames: Frame[], threshold = RULES.cutThreshold): number[] {
  const starts = [0];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].thumb;
    const b = frames[i].thumb;
    let diff = 0;
    for (let k = 0; k < a.length; k++) diff += Math.abs(a[k] - b[k]);
    if (diff / a.length > threshold) starts.push(i);
  }
  return starts;
}

/** Link faces across the frames of one shot into tracks (one per person), most visible first. */
export function buildTracks(frames: Frame[]): Track[] {
  const tracks: { xs: number[]; ys: number[]; hs: number[]; mouth: (number | null)[]; lastCx: number }[] = [];
  frames.forEach((f, i) => {
    const used = new Set<number>();
    for (const face of [...f.faces].sort((a, b) => b.h - a.h)) {
      let best = -1;
      let bestDist = RULES.matchDistance;
      tracks.forEach((tr, k) => {
        const d = Math.abs(tr.lastCx - face.cx);
        if (!used.has(k) && d < bestDist) { best = k; bestDist = d; }
      });
      if (best < 0) {
        tracks.push({ xs: [], ys: [], hs: [], mouth: Array(frames.length).fill(null), lastCx: face.cx });
        best = tracks.length - 1;
      }
      used.add(best);
      const tr = tracks[best];
      tr.xs.push(face.cx); tr.ys.push(face.cy); tr.hs.push(face.h); tr.mouth[i] = face.mouth; tr.lastCx = face.cx;
    }
  });
  return tracks
    .map((tr) => ({ cx: median(tr.xs), cy: median(tr.ys), h: median(tr.hs), presence: tr.xs.length / frames.length, mouth: tr.mouth }))
    .filter((tr) => tr.presence >= RULES.minPresence)
    .sort((a, b) => b.presence * b.h - a.presence * a.h);
}

/** How much each track's mouth is moving around each frame (mean absolute change over a window). */
export function mouthActivity(track: Track, fps: number): number[] {
  const deltas = track.mouth.map((m, i) => {
    const prev = track.mouth[i - 1];
    return m != null && prev != null ? Math.abs(m - prev) : null;
  });
  const half = Math.max(1, Math.round((RULES.activityWindow * fps) / 2));
  return deltas.map((_, i) => {
    const win = deltas.slice(Math.max(0, i - half), i + half + 1).filter((d): d is number => d != null);
    return win.length ? win.reduce((s, d) => s + d, 0) / win.length : 0;
  });
}

/**
 * Plan the framing for one shot.
 * - no face: fit; one face: follow it; two faces that fit in one 9:16 window: frame both;
 * - two faces apart: follow whoever is talking, or stack both when it's unclear.
 */
export function planShot(frames: Frame[], start: number, end: number, cropWidth: number, fps: number): Segment[] {
  const tracks = buildTracks(frames);
  if (tracks.length === 0) return [{ start, end, layout: { kind: "fit" } }];
  if (tracks.length === 1) return [{ start, end, layout: { kind: "crop", cx: tracks[0].cx } }];

  const [a, b] = [tracks[0], tracks[1]].sort((x, y) => x.cx - y.cx); // a = left, b = right
  const span = b.cx - a.cx + (a.h + b.h) * 0.3; // rough width needed to keep both heads in
  if (span <= cropWidth * 0.9) return [{ start, end, layout: { kind: "crop", cx: (a.cx + b.cx) / 2 } }];

  const actA = mouthActivity(a, fps);
  const actB = mouthActivity(b, fps);
  const split: Layout = { kind: "split", top: a, bottom: b };
  // Per frame: who is clearly talking? null = can't tell.
  const talker = frames.map((_, i) => {
    const hi = Math.max(actA[i], actB[i]);
    const lo = Math.min(actA[i], actB[i]);
    if (hi < RULES.minActivity || hi < lo * RULES.dominance) return null;
    return actA[i] > actB[i] ? a : b;
  });

  // Brief pauses keep the current speaker; a long stretch where nobody (or everybody) is
  // clearly talking shows both people stacked.
  const maxUnclear = Math.round(RULES.unclearToSplit * fps);
  const layouts: Layout[] = [];
  let current: Layout = split;
  for (let i = 0; i < talker.length; ) {
    let j = i;
    while (j < talker.length && talker[j] === null) j++;
    if (j > i) {
      if (j - i > maxUnclear) current = split;
      else if (i === 0 && j < talker.length) current = { kind: "crop", cx: talker[j]!.cx }; // open on the first talker
      for (let k = i; k < j; k++) layouts.push(current);
      i = j;
    } else {
      current = { kind: "crop", cx: talker[i]!.cx };
      layouts.push(current);
      i++;
    }
  }
  return smooth(
    layouts.map((layout, i) => ({ start: start + (i * (end - start)) / frames.length, end: start + ((i + 1) * (end - start)) / frames.length, layout })),
  );
}

/** Merge runs of the same layout and absorb runs shorter than minSegment into a neighbour. */
export function smooth(segs: Segment[]): Segment[] {
  const same = (x: Layout, y: Layout) =>
    x.kind === y.kind && (x.kind !== "crop" || Math.abs(x.cx - (y as { cx: number }).cx) < 1e-6);
  const merge = (list: Segment[]) =>
    list.reduce<Segment[]>((out, s) => {
      const last = out[out.length - 1];
      if (last && same(last.layout, s.layout)) last.end = s.end;
      else out.push({ ...s });
      return out;
    }, []);

  let out = merge(segs);
  for (;;) {
    const i = out.findIndex((s) => s.end - s.start < RULES.minSegment);
    if (i < 0 || out.length === 1) return out;
    // Hand the short run to its longer neighbour.
    const prev = out[i - 1];
    const next = out[i + 1];
    const target = !next || (prev && prev.end - prev.start >= next.end - next.start) ? prev : next;
    if (target === prev) prev.end = out[i].end;
    else next.start = out[i].start;
    out.splice(i, 1);
    out = merge(out);
  }
}

/** Full plan for a clip: split into shots, plan each. Times are seconds from clip start. */
export function planFraming(frames: Frame[], duration: number, cropWidth: number, fps: number): Segment[] {
  if (frames.length === 0) return [{ start: 0, end: duration, layout: { kind: "fit" } }];
  const starts = findShots(frames);
  const segs: Segment[] = [];
  starts.forEach((s, k) => {
    const e = k + 1 < starts.length ? starts[k + 1] : frames.length;
    // A cut happens somewhere between two samples; put the boundary halfway.
    const t0 = k === 0 ? 0 : (frames[s].t - 0.5 / fps);
    const t1 = k + 1 < starts.length ? frames[e].t - 0.5 / fps : duration;
    segs.push(...planShot(frames.slice(s, e), t0, t1, cropWidth, fps));
  });
  // Shots themselves are never merged across a cut, so only merge identical neighbours.
  return segs.map((s) => ({ ...s, start: round2(s.start), end: round2(s.end) }));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
