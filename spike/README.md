# Slice 0 spike

One script that answers the first product question: can AI reliably pick moments worth turning into Shorts?

```
long video -> faster-whisper (word timestamps) -> Claude picks 5-10 moments (30-60s, with reasons)
           -> ffmpeg cuts each to 1080x1920 with burned-in captions -> report.md
```

## Run

Needs Python 3.10+, ffmpeg on PATH, and `ANTHROPIC_API_KEY` for the picking step.

```
python3 -m pip install -r spike/requirements.txt
python3 spike/clip_spike.py run path/to/video.mp4 --out out/
```

Outputs in `out/`: `transcript.json`, `picks.json`, `report.md`, `clips/*.mp4`.

Steps can run separately (`transcribe`, `pick`, `cut`). `prompt` prints the picker prompt so it can be pasted into Claude by hand, and `--picks file.json` feeds picks back in without an API key.

Options: `--whisper-model` (default `small`; `base` is faster, `medium` more accurate), `PICKER_MODEL` env var (default `claude-opus-5-5`).

The first run downloads the whisper model from huggingface.co.

## What it does not do yet

- Reframing is a centre crop, so off-centre speakers get cut off. Face tracking is the obvious next step.
- No speaker diarisation; picks are judged on text only.
- Captions are plain 3-word chunks, no per-word highlight.
