# clipping-saas

Long-form video -> AI-selected short-form clips.

## MVP web app (runs on your machine)
Needs Node 20+, FFmpeg on PATH and `.env.local` (copy `.env.example`) with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.

    npm install
    npm run dev

Open http://localhost:3000, drop in a video, and wait while it extracts audio, transcribes and finds clips.
Press **Preview** on a suggestion to play that moment from the original, tick the ones you want, and press
**Render selected**. Each finished clip plays in the page and has a **Download** button.

`npm run dev` starts two processes side by side:
- **web** (`app/`): the Next.js site and its API routes. It saves uploads and reads progress, nothing slow.
- **worker** (`worker/index.ts`): picks up new uploads and render requests and runs the pipeline one job at a time.

Everything is stored in `data/` (git-ignored; set `DATA_DIR` to move it). See `lib/store.ts` for the layout.
The worker is the only process that edits a project's `project.json`; the web app asks it for work by
dropping files in that project's `requests/` folder. Stopping the worker mid-job is safe: it restarts the job
next time, and a saved transcript is reused, so retries don't pay for transcription twice.

Costs per video: Whisper transcription (about $0.006 per minute of audio) and one Claude call to pick clips.
Rendering and face tracking run locally and cost nothing.

## Pipeline (`pipeline/`)
Shared by the web app's worker and the spike CLI: `audio.ts` (FFmpeg audio), `transcribe.ts` (Whisper),
`analyse.ts` + `validate.ts` (Claude picks clips, then we clean them up), `render.ts` (vertical clip with
captions), `faces.ts` + `framing.ts` (speaker framing).

### Speaker framing
Each clip is sampled at 5 fps and faces are found locally (face-api on TensorFlow.js WASM, no API cost).
Per camera shot it picks a layout: follow the one face; frame two people together if they fit;
in a wide two-shot follow whoever's mouth is moving, or stack both speakers when that's unclear
for 3s+; with no face, show the whole frame over a blurred copy. The chosen layout per stretch of
the clip is saved as `NN_title.framing.json` next to each clip. Thresholds live in `RULES` in
`pipeline/framing.ts`.

## Spike CLI
    npm run spike -- path/to/video.mp4 [--refresh] [--no-render] [--centre]

Outputs go to `spike/out/` (git-ignored): audio, cached transcript, clip suggestions, and a
`<video>.clips/` folder of 1080x1920 MP4s. `--no-render` only gets the suggestions, `--centre` uses a plain
centre crop instead of speaker framing, `--refresh` redoes the transcript.
