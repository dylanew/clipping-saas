/**
 * Background worker: does the slow, paid work (FFmpeg, Whisper, Claude, face framing) one job at a time.
 * It checks data/projects every couple of seconds for new uploads and render requests.
 * It is the only writer of project.json after an upload, so web requests never clash with it.
 */
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { extractAudio } from "../pipeline/audio.js";
import { transcribe } from "../pipeline/transcribe.js";
import { suggestClips } from "../pipeline/analyse.js";
import { renderClip } from "../pipeline/render.js";
import type { Transcript } from "../pipeline/types.js";
import {
  clearRequest, dataDir, listProjects, pendingRequests, projectDir, saveProject,
  type ClipState, type Project,
} from "../lib/store.js";

config({ path: ".env.local" });

const POLL_MS = 2000;
const log = (p: Project, msg: string) => console.log(`[${p.id}] ${msg}`);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Jobs that were mid-way when the worker stopped are started again. */
function recover(): void {
  for (const p of listProjects()) {
    let changed = false;
    if (["extracting", "transcribing", "analysing"].includes(p.status)) { p.status = "queued"; changed = true; }
    for (const c of p.clips) if (c.render === "rendering") { c.render = "queued"; changed = true; }
    if (changed) saveProject(p);
  }
}

/** Move the user's requests (render this clip, retry) into project.json. */
function applyRequests(p: Project): void {
  const reqs = pendingRequests(p.id);
  if (reqs.length === 0) return;
  for (const r of reqs) {
    if (r.type === "retry" && p.status === "failed") { p.status = "queued"; p.error = undefined; }
    if (r.type === "render") {
      const c = p.clips.find((c) => c.id === r.clipId);
      if (c && (c.render === "none" || c.render === "failed")) { c.render = "queued"; c.error = undefined; }
    }
  }
  saveProject(p);
  for (const r of reqs) clearRequest(p.id, r);
}

/** Upload -> audio -> transcript -> clip suggestions. The transcript is cached, so a retry never pays for it twice. */
async function processProject(p: Project): Promise<void> {
  const dir = projectDir(p.id);
  const transcriptPath = path.join(dir, "transcript.json");
  const step = (status: Project["status"]) => { p.status = status; saveProject(p); log(p, status); };
  try {
    let transcript: Transcript;
    if (fs.existsSync(transcriptPath)) {
      transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
    } else {
      step("extracting");
      const audioPath = path.join(dir, "audio.mp3");
      await extractAudio(path.join(dir, p.source), audioPath);
      step("transcribing");
      transcript = await transcribe(audioPath);
      fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    }
    step("analysing");
    const { clips } = await suggestClips(transcript);
    p.duration = transcript.duration;
    p.clips = clips.map((c, i) => ({ ...c, id: i + 1, render: "none" }));
    step("ready");
    log(p, `${clips.length} clips suggested`);
  } catch (e) {
    p.status = "failed";
    p.error = message(e);
    saveProject(p);
    log(p, `failed: ${p.error}`);
  }
}

async function renderOne(p: Project, clip: ClipState): Promise<void> {
  const dir = projectDir(p.id);
  clip.render = "rendering";
  saveProject(p);
  log(p, `rendering clip ${clip.id}: ${clip.title}`);
  try {
    const transcript: Transcript = JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf8"));
    const file = await renderClip(path.join(dir, p.source), transcript.words, clip, clip.id, path.join(dir, "clips"));
    clip.render = "done";
    clip.file = path.basename(file);
    log(p, `clip ${clip.id} done`);
  } catch (e) {
    clip.render = "failed";
    clip.error = message(e);
    log(p, `clip ${clip.id} failed: ${clip.error}`);
  }
  saveProject(p);
}

/** Do at most one job. Returns false when there was nothing to do. */
async function tick(): Promise<boolean> {
  const projects = listProjects().reverse(); // oldest first
  for (const p of projects) applyRequests(p);

  const queued = projects.find((p) => p.status === "queued");
  if (queued) { await processProject(queued); return true; }

  for (const p of projects) {
    const clip = p.clips.find((c) => c.render === "queued");
    if (clip) { await renderOne(p, clip); return true; }
  }
  return false;
}

console.log(`Worker watching ${dataDir()}`);
recover();
for (;;) {
  try {
    if (!(await tick())) await new Promise((r) => setTimeout(r, POLL_MS));
  } catch (e) {
    console.error("Worker error:", e);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
