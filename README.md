# clipping-saas

Long-form video -> AI-selected short-form clips.

## Slice 0: AI quality spike
Needs FFmpeg on PATH and `.env.local` (copy `.env.example`) with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.

    npm install
    npm run spike -- path/to/video.mp4

Outputs go to `spike/out/` (git-ignored): audio, cached transcript, clip suggestions, and a
`<video>.clips/` folder of 1080x1920 MP4s with burned-in captions (centre-cropped).
Add `--no-render` to only get the suggestions.
Re-running reuses the cached transcript (no repeat transcription cost); add `--refresh` to redo it.
