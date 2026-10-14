"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/safe-next";

/** Email link or Google. Both come back through /auth/callback, which starts the session. */
export default function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: callback() } });
    if (error) { setError(error.message); setState("idle"); } else setState("sent");
  }

  async function google() {
    setError("");
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback() } });
    if (error) setError(error.message); // on success the browser is already on its way to Google
  }

  if (state === "sent") {
    return <p className="card">Check <strong>{email}</strong> for a sign-in link. You can close this tab.</p>;
  }
  return (
    <div className="card">
      <button className="primary wide" onClick={google}>Continue with Google</button>
      <p className="muted small or">or</p>
      <form onSubmit={sendLink}>
        <label htmlFor="email" className="small">Email</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="wide" disabled={state === "sending"}>
          {state === "sending" ? "Sending..." : "Email me a sign-in link"}
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
