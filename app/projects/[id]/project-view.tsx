"use client";

import { useEffect, useRef, useState } from "react";
import type { ClipState, Project } from "@/lib/store";
import { STATUS_LABEL } from "../../labels";

const STEPS = ["extracting", "transcribing", "analysing"] as const;
const POLL_MS = 2000;

function time(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

/** Still waiting on the worker for anything? Then keep polling. */
function busy(p: Project): boolean {
  return !["ready", "failed"].includes(p.status) || p.clips.some((c) => c.render === "queued" || c.render === "rendering");
}

export default function ProjectView({ initial }: { initial: Project }) {
  const [project, setProject] = useState(initial);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const player = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const base = `/api/projects/${project.id}`;

  async function refresh() {
    const res = await fetch(base, { cache: "no-store" });
    if (res.ok) setProject(await res.json());
  }

  const isBusy = busy(project);
  useEffect(() => {
    if (!isBusy) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [isBusy]);

  /** Play just this clip's stretch of the original video. */
  function preview(c: ClipState) {
    const v = player.current;
    if (!v) return;
    stopAt.current = c.end;
    setPlaying(c.id);
    v.currentTime = c.start;
    void v.play();
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function onTimeUpdate() {
    const v = player.current;
    if (v && stopAt.current !== null && v.currentTime >= stopAt.current) {
      v.pause();
      stopAt.current = null;
      setPlaying(null);
    }
  }

  async function render(ids: number[]) {
    await fetch(`${base}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds: ids }),
    });
    setSelected(new Set());
    await refresh();
  }

  async function retry() {
    await fetch(`${base}/retry`, { method: "POST" });
    await refresh();
  }

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const selectable = project.clips.filter((c) => c.render === "none" || c.render === "failed");
  const stepIndex = STEPS.indexOf(project.status as (typeof STEPS)[number]);

  return (
    <>
      <h1>{project.name}</h1>

      {project.status !== "ready" && (
        <section className="card">
          {project.status === "failed" ? (
            <>
              <p className="error">Processing failed: {project.error}</p>
              <button onClick={retry}>Try again</button>
            </>
          ) : (
            <ol className="steps">
              <li className="done">Uploaded</li>
              {STEPS.map((s, i) => (
                <li key={s} className={i < stepIndex ? "done" : i === stepIndex ? "active" : ""}>
                  {STATUS_LABEL[s]}
                </li>
              ))}
            </ol>
          )}
          {project.status === "queued" && <p className="muted">Waiting for the worker to pick this up…</p>}
          {project.status === "transcribing" && <p className="muted">Transcription takes about a minute per 10 minutes of video.</p>}
        </section>
      )}

      <div className="review">
        <div className="player">
          <video ref={player} src={`${base}/video`} controls preload="metadata" onTimeUpdate={onTimeUpdate} />
          <p className="muted small">Original video. Press Preview on a clip to play just that moment.</p>
        </div>

        {project.status === "ready" && (
          <div className="clips">
            {project.clips.length === 0 ? (
              <p>No strong moments were found in this video.</p>
            ) : (
              <div className="toolbar">
                <span>{project.clips.length} suggested clips, best first</span>
                <button
                  className="link"
                  disabled={selectable.length === 0}
                  onClick={() => setSelected(new Set(selectable.map((c) => c.id)))}
                >
                  Select all
                </button>
                <button className="primary" disabled={selected.size === 0} onClick={() => render([...selected])}>
                  Render {selected.size || ""} selected
                </button>
              </div>
            )}

            {project.clips.map((c) => (
              <article key={c.id} className={`clip ${selected.has(c.id) ? "selected" : ""}`}>
                <div className="clip-main">
                  <label className="clip-title">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      disabled={!selectable.includes(c)}
                      onChange={() => toggle(c.id)}
                    />
                    <span>{c.title}</span>
                  </label>
                  <p className="muted small">
                    {time(c.start)}–{time(c.end)} · {Math.round(c.end - c.start)}s · score {Math.round(c.score * 100)}
                  </p>
                  <p className="reason">{c.reason}</p>
                  <div className="actions">
                    <button onClick={() => preview(c)}>{playing === c.id ? "Playing…" : "▶ Preview"}</button>
                    {c.render === "queued" && <span className="badge queued">Queued to render</span>}
                    {c.render === "rendering" && <span className="badge active">Rendering…</span>}
                    {c.render === "failed" && (
                      <>
                        <span className="badge failed" title={c.error}>Render failed</span>
                        <button onClick={() => render([c.id])}>Try again</button>
                      </>
                    )}
                    {c.render === "done" && (
                      <a className="button primary" href={`${base}/video?clip=${c.id}&download=1`}>Download</a>
                    )}
                  </div>
                </div>
                {c.render === "done" && (
                  <video className="vertical" src={`${base}/video?clip=${c.id}`} controls preload="metadata" />
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
