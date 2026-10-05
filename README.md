# clipping-saas

Long-form video -> AI-selected short-form clips.

## Slice 0: AI quality spike
Needs FFmpeg on PATH and `.env.local` (copy `.env.example`) with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.

    npm install
    npm run spike -- path/to/video.mp4

Outputs go to `spike/out/` (git-ignored): audio, cached transcript, clip suggestions.
Re-running reuses the cached transcript (no repeat transcription cost); add `--refresh` to redo it.
