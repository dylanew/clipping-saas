import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import type { Face, Frame } from "./framing.js";

// face-api's Node WASM build is CommonJS and pure JS/WASM, so it runs on Intel and Apple Silicon Macs
// without native TensorFlow binaries.
const require = createRequire(import.meta.url);

/** Frames per second sampled for face analysis. Enough to see mouths move; keeps a 60s clip to ~300 detections. */
export const SAMPLE_FPS = 5;
const ANALYSIS_WIDTH = 640;
const THUMB_W = 32;
const THUMB_H = 18;

let faceapi: any;
let tf: any;

async function load(): Promise<void> {
  if (faceapi) return;
  tf = require("@tensorflow/tfjs");
  const wasm = require("@tensorflow/tfjs-backend-wasm");
  faceapi = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
  wasm.setWasmPaths(path.dirname(require.resolve("@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm")) + "/");
  await tf.setBackend("wasm");
  await tf.ready();
  const modelDir = path.join(path.dirname(require.resolve("@vladmandic/face-api/package.json")), "model");
  await faceapi.nets.tinyFaceDetector.loadFromDisk(modelDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
}

/** Video width and height via ffprobe. */
export function probeSize(videoPath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x", videoPath]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => {
      const [width, height] = out.trim().split("x").map(Number);
      code === 0 && width && height ? resolve({ width, height }) : reject(new Error(`ffprobe failed for ${videoPath}`));
    });
  });
}

/** Downscaled greyscale copy of an RGB frame, used to spot camera cuts. */
function thumbnail(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(THUMB_W * THUMB_H);
  for (let ty = 0; ty < THUMB_H; ty++) {
    for (let tx = 0; tx < THUMB_W; tx++) {
      const i = (Math.floor(((ty + 0.5) * h) / THUMB_H) * w + Math.floor(((tx + 0.5) * w) / THUMB_W)) * 3;
      out[ty * THUMB_W + tx] = (rgb[i] * 299 + rgb[i + 1] * 587 + rgb[i + 2] * 114) / 1000;
    }
  }
  return out;
}

/**
 * Sample the clip at SAMPLE_FPS and find faces in each frame.
 * Positions are fractions of the frame (0-1) so they don't depend on the analysis resolution.
 */
export async function analyseFaces(videoPath: string, start: number, end: number, src: { width: number; height: number }): Promise<Frame[]> {
  await load();
  const w = ANALYSIS_WIDTH;
  const h = Math.round((src.height / src.width) * w / 2) * 2;
  const frameBytes = w * h * 3;
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });

  const p = spawn("ffmpeg", ["-loglevel", "error", "-ss", start.toFixed(2), "-to", end.toFixed(2), "-i", videoPath,
    "-vf", `fps=${SAMPLE_FPS},scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  const exited = new Promise<number>((resolve) => p.on("close", resolve));

  const frames: Frame[] = [];
  let pending = Buffer.alloc(0);
  for await (const chunk of p.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= frameBytes) {
      const rgb = new Uint8Array(pending.subarray(0, frameBytes));
      pending = pending.subarray(frameBytes);
      const input = tf.tensor3d(rgb, [h, w, 3]);
      const found = await faceapi.detectAllFaces(input, options).withFaceLandmarks();
      input.dispose();
      const faces: Face[] = found.map((r: any) => {
        const b = r.detection.box;
        const mouth = r.landmarks.getMouth(); // points 48-67; inner lips are 62 (top) and 66 (bottom)
        const gap = Math.hypot(mouth[14].x - mouth[18].x, mouth[14].y - mouth[18].y);
        return { cx: (b.x + b.width / 2) / w, cy: (b.y + b.height / 2) / h, w: b.width / w, h: b.height / h, mouth: gap / b.height };
      });
      frames.push({ t: frames.length / SAMPLE_FPS, faces, thumb: thumbnail(rgb, w, h) });
    }
  }
  if ((await exited) !== 0) throw new Error(`ffmpeg failed reading frames: ${err.slice(-500)}`);
  return frames;
}
