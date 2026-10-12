import { notFound } from "next/navigation";
import { projectView } from "@/lib/store";
import ProjectView from "./project-view";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const project = projectView((await params).id);
  if (!project) notFound();
  return <ProjectView initial={project} />;
}
