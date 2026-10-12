import { spawn } from "node:child_process";

/** Extract mono 16 kHz 32 kbps MP3 (~14 MB/hour) - small enough to upload cheaply. */
export function extractAudio(videoPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", outPath];
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`)),
    );
  });
}
