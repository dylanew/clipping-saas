# Clipping SaaS

Turns long-form video into short-form clips: upload -> transcribe -> AI suggests moments -> user picks -> FFmpeg renders vertical clip.

## Working rules
- The owner is learning: explain significant changes (what/why/files/how to test) and get approval for architectural decisions.
- Build incrementally; only what the current feature needs. No microservices/queues/ORMs unless required.
- Never hard-code secrets. Use env vars; `.env.local` is git-ignored. Keep `.env.example` current.
- Do not push to GitHub unless explicitly asked.
- Flag expensive decisions (storage, transcription, LLM, bandwidth).

## Planned architecture
Next.js app + Supabase (Auth, Postgres with RLS, Storage) + a separate Node worker running FFmpeg and AI calls. Postgres is the job queue.

## Current state
Phase 2: local MVP web app. Next.js (`app/`) + a polling worker (`worker/`) sharing `pipeline/` (the spike code).
Storage is local files in `data/` via `lib/store.ts` (stand-in for Supabase; the worker is the only writer of project.json).
Phase 1 in progress (plan: Claude Doc "Phase 1 plan: hosted app"). Sign-in works via Supabase Auth (email link + Google): `proxy.ts` guards every page and API route, `lib/supabase/` has the clients. Projects are still local files until slice 3. No payments or publishing yet.
Commands: `npm run dev` (web + worker), `npm run spike -- <video> [--refresh] [--no-render] [--centre]`, `npm run eval -- <videos or folder>` then `npm run eval:report` (batch quality test), `npm test`, `npm run typecheck`.
