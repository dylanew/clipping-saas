/**
 * Local file storage for MVP projects, shared by the web app and the worker.
 *
 * data/projects/<id>/
 *   project.json      state (written by the web app once at upload, then only by the worker)
 *   source.<ext>      the uploaded video
 *   audio.mp3, transcript.json
 *   clips/NN_title.mp4
 *   requests/*.json   things the user asked for (render a clip, retry); the worker picks them up and deletes them
 *
 * One writer per file keeps this safe without a database. Later this maps onto
 * Supabase: project.json -> a Postgres row, requests -> a jobs table, files -> Storage.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type ProjectStatus = "queued" | "extracting" | "transcribing" | "analysing" | "ready" | "failed";
export type RenderStatus = "none" | "queued" | "rendering" | "done" | "failed";

export interface ClipState {
  id: number; // 1-based, best clip first
  start: number;
  end: number;
  title: string;
  reason: string;
  score: number;
  render: RenderStatus;
  file?: string; // file name inside clips/ once rendered
  error?: string;
}

export interface Project {
  id: string;
  name: string; // original file name
  source: string; // file name inside the project folder
  createdAt: string;
  status: ProjectStatus;
  error?: string;
  duration?: number;
  clips: ClipState[];
}

export type Request = { type: "render"; clipId: number } | { type: "retry" };

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".mkv", ".webm"];

export function dataDir(): string {
  // The ignore hint stops Next.js from treating user data as app code to bundle.
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? "data");
}
const projectsDir = () => path.join(dataDir(), "projects");

export function isValidId(id: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(id);
}

export function projectDir(id: string): string {
  if (!isValidId(id)) throw new Error(`Bad project id: ${id}`);
  return path.join(projectsDir(), id);
}

/** Write via a temp file + rename so a reader never sees half a file. */
function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function newProjectId(name: string): string {
  const stem = path.parse(name).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  return `${stem || "video"}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Create a project for an upload that has already been saved to sourcePath (moved into place here). */
export function createProject(id: string, name: string, sourcePath: string): Project {
  const dir = projectDir(id);
  const source = `source${path.extname(name).toLowerCase()}`;
  fs.mkdirSync(path.join(dir, "requests"), { recursive: true });
  fs.renameSync(sourcePath, path.join(dir, source));
  const project: Project = { id, name, source, createdAt: new Date().toISOString(), status: "queued", clips: [] };
  writeJson(path.join(dir, "project.json"), project); // written last: the worker only sees complete uploads
  return project;
}

export function getProject(id: string): Project | null {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir(id), "project.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Worker only. */
export function saveProject(p: Project): void {
  writeJson(path.join(projectDir(p.id), "project.json"), p);
}

export function listProjects(): Project[] {
  if (!fs.existsSync(projectsDir())) return [];
  return fs.readdirSync(projectsDir())
    .map((id) => getProject(id))
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addRequest(id: string, req: Request): void {
  const name = req.type === "render" ? `render-${req.clipId}` : "retry";
  writeJson(path.join(projectDir(id), "requests", `${name}.json`), req);
}

export function pendingRequests(id: string): Request[] {
  const dir = path.join(projectDir(id), "requests");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Request];
      } catch {
        return []; // being written right now; pick it up next time
      }
    });
}

/** Worker only: remove a request once it has been applied to project.json. */
export function clearRequest(id: string, req: Request): void {
  const name = req.type === "render" ? `render-${req.clipId}` : "retry";
  fs.rmSync(path.join(projectDir(id), "requests", `${name}.json`), { force: true });
}

/** Project as the browser should see it: clips the user just asked for show as queued straight away. */
export function projectView(id: string): Project | null {
  const p = getProject(id);
  if (!p) return null;
  for (const r of pendingRequests(id)) {
    if (r.type === "retry" && p.status === "failed") { p.status = "queued"; p.error = undefined; }
    if (r.type === "render") {
      const c = p.clips.find((c) => c.id === r.clipId);
      if (c && c.render !== "rendering") c.render = "queued";
    }
  }
  return p;
}
