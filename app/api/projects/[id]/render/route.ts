import { NextResponse } from "next/server";
import { addRequest, getProject } from "@/lib/store";

export const runtime = "nodejs";

/** Body: { clipIds: number[] }. Queues those clips for the worker to render. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = getProject((await params).id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const ids: unknown = body?.clipIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "clipIds must be a non-empty array" }, { status: 400 });
  }
  const known = new Set(project.clips.map((c) => c.id));
  for (const clipId of ids) {
    if (typeof clipId === "number" && known.has(clipId)) addRequest(project.id, { type: "render", clipId });
  }
  return NextResponse.json({ ok: true });
}
