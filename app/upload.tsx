"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Drag-and-drop or pick a video; sends it with XMLHttpRequest because fetch can't report upload progress. */
export default function Upload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  function upload(file: File) {
    setError("");
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects?name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || "{}");
      if (xhr.status === 201) router.push(`/projects/${body.id}`);
      else { setError(body.error ?? `Upload failed (${xhr.status})`); setProgress(null); }
    };
    xhr.onerror = () => { setError("Upload failed. Is the app still running?"); setProgress(null); };
    xhr.send(file);
  }

  const uploading = progress !== null;
  return (
    <div
      className={`dropzone ${dragging ? "over" : ""}`}
      onClick={() => !uploading && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && !uploading) upload(file);
      }}
    >
      <input
        ref={input} type="file" accept="video/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
      />
      {uploading ? (
        <>
          <p>Uploading… {Math.round(progress * 100)}%</p>
          <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>
        </>
      ) : (
        <p><strong>Drop a video here</strong> or click to choose one (MP4 works best)</p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
