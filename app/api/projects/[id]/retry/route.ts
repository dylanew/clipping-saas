import { NextResponse } from "next/server";
import { addRequest, getProject } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = getProject((await params).id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  addRequest(project.id, { type: "retry" });
  return NextResponse.json({ ok: true });
}
