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
Phase 1: AI quality spike in `spike/` (CLI, no app yet).
Commands: `npm run spike -- <video> [--refresh] [--no-render]`, `npm test`, `npm run typecheck`.
