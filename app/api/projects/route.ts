import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { createProject, dataDir, listProjects, newProjectId, VIDEO_EXTENSIONS } from "@/lib/store";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(listProjects());
}

/**
 * Upload: the browser sends the raw file as the request body (?name=<file name>).
 * It is streamed straight to disk, so multi-GB videos never sit in memory.
 */
export async function POST(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!VIDEO_EXTENSIONS.includes(path.extname(name).toLowerCase())) {
    return NextResponse.json({ error: `Upload a video file (${VIDEO_EXTENSIONS.join(", ")})` }, { status: 400 });
  }
  if (!req.body) return NextResponse.json({ error: "Empty upload" }, { status: 400 });

  const id = newProjectId(name);
  const tmpDir = path.join(dataDir(), "uploads");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${id}.part`);
  try {
    await pipeline(Readable.fromWeb(req.body as WebReadableStream), fs.createWriteStream(tmp));
  } catch {
    fs.rmSync(tmp, { force: true });
    return NextResponse.json({ error: "Upload interrupted" }, { status: 400 });
  }
  const project = createProject(id, path.basename(name), tmp);
  return NextResponse.json(project, { status: 201 });
}
