#!/usr/bin/env python3
"""Slice 0 spike: long video -> transcript -> AI-picked moments -> vertical captioned clips.

Usage:
    python spike/clip_spike.py run input.mp4 --out out/
    python spike/clip_spike.py transcribe input.mp4 --out out/
    python spike/clip_spike.py pick --out out/              # needs ANTHROPIC_API_KEY
    python spike/clip_spike.py prompt --out out/            # print the picker prompt (run it anywhere)
    python spike/clip_spike.py cut input.mp4 --out out/ [--picks picks.json]

Everything lands in --out: transcript.json, picks.json, report.md, clips/*.mp4.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

MIN_LEN = 30.0
MAX_LEN = 60.0
PICKER_MODEL = os.environ.get("PICKER_MODEL", "claude-opus-5-5")


# ---------------------------------------------------------------- transcribe

def transcribe(video: Path, out: Path, model_size: str) -> dict:
    from faster_whisper import WhisperModel

    out.mkdir(parents=True, exist_ok=True)
    audio = out / "audio.wav"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(audio)])

    t0 = time.time()
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(audio), word_timestamps=True, vad_filter=True)
    segs = []
    for s in segments:
        segs.append({
            "start": round(s.start, 2),
            "end": round(s.end, 2),
            "text": s.text.strip(),
            "words": [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()} for w in (s.words or [])],
        })
        print(f"  [{fmt_ts(s.start)}] {s.text.strip()}", file=sys.stderr)
    transcript = {
        "source": str(video),
        "language": info.language,
        "duration": round(info.duration, 2),
        "model": model_size,
        "transcribe_seconds": round(time.time() - t0, 1),
        "segments": segs,
    }
    (out / "transcript.json").write_text(json.dumps(transcript, indent=1))
    audio.unlink(missing_ok=True)
    print(f"transcribed {info.duration:.0f}s of audio in {transcript['transcribe_seconds']}s", file=sys.stderr)
    return transcript


# ---------------------------------------------------------------- pick

PICK_INSTRUCTIONS = f"""You are an experienced short-form video editor. Below is a timestamped transcript of a long-form video.
Pick the 5 to 10 strongest standalone moments to cut into YouTube Shorts / TikToks / Reels.

A strong moment:
- makes sense to someone who has not seen the rest of the video (no dangling "as I said earlier", no missing setup)
- opens with a hook in the first 3 seconds: a bold claim, a surprising fact, a question, conflict, or a punchline setup
- has a payoff: a story resolves, a point lands, a joke lands, a concrete tip is delivered
- is between {MIN_LEN:.0f} and {MAX_LEN:.0f} seconds long, and starts and ends on sentence boundaries

Avoid intros, sponsor reads, housekeeping, and moments that only work with visuals you cannot see.
Do not pick overlapping moments. Rank them best first. Be honest in the score: if the video has few great moments, give low scores rather than inventing quality.

Each line of the transcript is "[start_seconds-end_seconds] text". Use those numbers for start and end."""

PICK_SCHEMA = {
    "type": "object",
    "properties": {
        "moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "number", "description": "start time in seconds"},
                    "end": {"type": "number", "description": "end time in seconds"},
                    "title": {"type": "string", "description": "short working title for the clip"},
                    "hook": {"type": "string", "description": "the opening line that grabs attention"},
                    "reason": {"type": "string", "description": "why this works as a standalone short"},
                    "score": {"type": "integer", "description": "1-10 how confident you are this is a strong short"},
                },
                "required": ["start", "end", "title", "hook", "reason", "score"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["moments"],
    "additionalProperties": False,
}


def build_prompt(transcript: dict) -> str:
    lines = [f"[{s['start']:.1f}-{s['end']:.1f}] {s['text']}" for s in transcript["segments"]]
    return PICK_INSTRUCTIONS + "\n\n<transcript>\n" + "\n".join(lines) + "\n</transcript>"


def pick(transcript: dict, out: Path) -> list[dict]:
    import anthropic

    client = anthropic.Anthropic()
    resp = client.beta.messages.create(
        model=PICKER_MODEL,
        max_tokens=16000,
        # On a safety decline, the API retries on a suitable fallback model inside the same call.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": PICK_SCHEMA}},
        messages=[{"role": "user", "content": build_prompt(transcript)}],
    )
    if resp.stop_reason == "refusal":
        sys.exit(f"picker refused: {resp.stop_details}")
    text = next(b.text for b in resp.content if b.type == "text")
    moments = json.loads(text)["moments"]
    u = resp.usage
    print(f"picker: {len(moments)} moments, {u.input_tokens} in / {u.output_tokens} out tokens", file=sys.stderr)
    return save_picks(moments, transcript, out)


def save_picks(moments: list[dict], transcript: dict, out: Path) -> list[dict]:
    moments = [snap(m, transcript) for m in moments]
    (out / "picks.json").write_text(json.dumps(moments, indent=1))
    return moments


def snap(m: dict, transcript: dict) -> dict:
    """Snap LLM times onto real word boundaries and enforce the length window."""
    words = [w for s in transcript["segments"] for w in s["words"]]
    if not words:
        return m
    start = min(words, key=lambda w: abs(w["start"] - m["start"]))["start"]
    end = min(words, key=lambda w: abs(w["end"] - m["end"]))["end"]
    if end - start > MAX_LEN:  # trim back to the last word that fits
        end = max(w["end"] for w in words if w["end"] <= start + MAX_LEN)
    m = dict(m, llm_start=m["start"], llm_end=m["end"], start=start, end=end)
    m["duration"] = round(end - start, 2)
    return m


# ---------------------------------------------------------------- cut

def cut(video: Path, transcript: dict, moments: list[dict], out: Path) -> None:
    clips = out / "clips"
    clips.mkdir(parents=True, exist_ok=True)
    words = [w for s in transcript["segments"] for w in s["words"]]
    for i, m in enumerate(moments, 1):
        name = f"{i:02d}_{slug(m['title'])}"
        ass = clips / f"{name}.ass"
        ass.write_text(make_ass([w for w in words if m["start"] <= w["start"] < m["end"]], m["start"]))
        vf = ("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,"
              f"ass={ffmpeg_escape(str(ass))}")
        t0 = time.time()
        run(["ffmpeg", "-y", "-loglevel", "error",
             "-ss", f"{m['start']:.2f}", "-to", f"{m['end']:.2f}", "-i", str(video),
             "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
             "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(clips / f"{name}.mp4")])
        m["file"] = f"clips/{name}.mp4"
        print(f"  cut {name}.mp4 ({m['duration']:.0f}s) in {time.time() - t0:.1f}s", file=sys.stderr)
    (out / "picks.json").write_text(json.dumps(moments, indent=1))


def make_ass(words: list[dict], offset: float, per_line: int = 3) -> str:
    """Burned-in captions: short chunks of a few words, big and centred in the lower third."""
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,DejaVu Sans,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for i in range(0, len(words), per_line):
        chunk = words[i:i + per_line]
        start = max(0.0, chunk[0]["start"] - offset)
        nxt = words[i + per_line]["start"] - offset if i + per_line < len(words) else chunk[-1]["end"] - offset
        end = max(chunk[-1]["end"] - offset, min(nxt, chunk[-1]["end"] - offset + 0.5))
        text = " ".join(w["word"] for w in chunk).upper().replace("{", "(").replace("}", ")")
        events.append(f"Dialogue: 0,{ass_ts(start)},{ass_ts(end)},Cap,,0,0,0,,{text}")
    return head + "\n".join(events) + "\n"


# ---------------------------------------------------------------- report

def report(transcript: dict, moments: list[dict], out: Path) -> None:
    lines = [f"# Slice 0 picks for `{Path(transcript['source']).name}`", "",
             f"Source length {fmt_ts(transcript['duration'])}, whisper `{transcript['model']}` "
             f"took {transcript['transcribe_seconds']}s, picker `{PICKER_MODEL}`.", ""]
    for i, m in enumerate(moments, 1):
        lines += [f"## {i}. {m['title']} (score {m['score']}/10)",
                  f"{fmt_ts(m['start'])} to {fmt_ts(m['end'])} ({m['duration']:.0f}s)" + (f", `{m['file']}`" if m.get("file") else ""),
                  "", f"**Hook:** {m['hook']}", "", f"**Why:** {m['reason']}", ""]
    (out / "report.md").write_text("\n".join(lines))


# ---------------------------------------------------------------- helpers

def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def fmt_ts(t: float) -> str:
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:04.1f}" if t >= 3600 else f"{int(t // 60)}:{t % 60:04.1f}"


def ass_ts(t: float) -> str:
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def slug(s: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in s.lower()).strip("_")[:40] or "clip"


def ffmpeg_escape(path: str) -> str:
    return path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def load(out: Path, name: str):
    p = out / name
    if not p.exists():
        sys.exit(f"missing {p}; run the earlier step first")
    return json.loads(p.read_text())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["run", "transcribe", "prompt", "pick", "cut"])
    ap.add_argument("video", nargs="?", type=Path)
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--whisper-model", default="small", help="tiny, base, small, medium, large-v3")
    ap.add_argument("--picks", type=Path, help="use these picks (JSON list or {moments: [...]}) instead of calling the API")
    a = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")
    if a.step in ("run", "transcribe", "cut") and not a.video:
        sys.exit(f"{a.step} needs a video path")
    a.out.mkdir(parents=True, exist_ok=True)

    if a.step == "transcribe":
        transcribe(a.video, a.out, a.whisper_model)
        return
    transcript = transcribe(a.video, a.out, a.whisper_model) if a.step == "run" else load(a.out, "transcript.json")
    if a.step == "prompt":
        print(build_prompt(transcript))
        return
    if a.picks:
        raw = json.loads(a.picks.read_text())
        moments = save_picks(raw["moments"] if isinstance(raw, dict) else raw, transcript, a.out)
    elif a.step in ("run", "pick"):
        moments = pick(transcript, a.out)
    else:
        moments = load(a.out, "picks.json")
    if a.step in ("run", "cut"):
        cut(a.video, transcript, moments, a.out)
    report(transcript, moments, a.out)
    print(f"done: {a.out / 'report.md'}", file=sys.stderr)


if __name__ == "__main__":
    main()
