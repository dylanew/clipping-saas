import Link from "next/link";
import { listProjects } from "@/lib/store";
import Upload from "./upload";
import { STATUS_LABEL } from "./labels";

export const dynamic = "force-dynamic"; // read the data folder on every visit

export default function Home() {
  const projects = listProjects();
  return (
    <>
      <h1>Turn a long video into shorts</h1>
      <p className="muted">Upload a video. It gets transcribed, the best moments are picked, and you choose which to render as vertical clips.</p>
      <Upload />
      {projects.length > 0 && (
        <section>
          <h2>Your videos</h2>
          <ul className="projects">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`}>{p.name}</Link>
                <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                <span className="muted">{new Date(p.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
