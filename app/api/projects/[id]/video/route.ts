import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getProject, projectDir } from "@/lib/store";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
};

/**
 * Streams the uploaded video, or a rendered clip with ?clip=<id>. Add &download=1 to save it.
 * Supports HTTP Range requests, which browsers need to seek inside a video.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = getProject((await params).id);
  if (!project) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);

  let file = path.join(projectDir(project.id), project.source);
  let downloadName = project.name;
  const clipId = url.searchParams.get("clip");
  if (clipId) {
    const clip = project.clips.find((c) => String(c.id) === clipId);
    if (!clip?.file) return new Response("Clip not rendered", { status: 404 });
    file = path.join(projectDir(project.id), "clips", clip.file);
    downloadName = clip.file;
  }
  if (!fs.existsSync(/* turbopackIgnore: true */ file)) return new Response("Not found", { status: 404 });

  const size = fs.statSync(/* turbopackIgnore: true */ file).size;
  const headers = new Headers({
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
  });
  if (url.searchParams.has("download")) {
    headers.set("Content-Disposition", `attachment; filename="${downloadName.replace(/["\\\r\n]/g, "_")}"`);
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    // "bytes=a-b", "bytes=a-" or "bytes=-n" (last n bytes)
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(stream(file, start, end), { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(stream(file, 0, size - 1), { headers });
}

function stream(file: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
}
