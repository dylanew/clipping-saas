# clipping-saas

Long-form video -> AI-selected short-form clips.

## Slice 0: AI quality spike
Needs FFmpeg on PATH and `.env.local` (copy `.env.example`) with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.

    npm install
    npm run spike -- path/to/video.mp4

Outputs go to `spike/out/` (git-ignored): audio, cached transcript, clip suggestions, and a
`<video>.clips/` folder of 1080x1920 MP4s with burned-in captions.
Add `--no-render` to only get the suggestions.

### Speaker framing
Each clip is sampled at 5 fps and faces are found locally (face-api on TensorFlow.js WASM, no API cost).
Per camera shot it picks a layout: follow the one face; frame two people together if they fit;
in a wide two-shot follow whoever's mouth is moving, or stack both speakers when that's unclear
for 3s+; with no face, show the whole frame over a blurred copy. The chosen layout per stretch of
the clip is saved as `NN_title.framing.json` next to each clip. Thresholds live in `RULES` in
`spike/framing.ts`. Add `--centre` to skip this and use a plain centre crop.
Re-running reuses the cached transcript (no repeat transcription cost); add `--refresh` to redo it.
