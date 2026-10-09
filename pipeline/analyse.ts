import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Transcript } from "./types.js";
import { ClipsResponseSchema, cleanClips, DEFAULT_RULES, type Clip } from "./validate.js";

const MODEL = process.env.CLIP_MODEL ?? "claude-sonnet-5-5";

const SYSTEM = `You are an expert short-form video editor (TikTok, Reels, Shorts).
You receive a timestamped transcript of a long video and pick the moments that work as
standalone shorts.

A good clip:
- Hooks in the first 3 seconds (bold claim, question, surprising fact, strong emotion).
- Is self-contained: a viewer with no context understands it.
- Has a clear payoff or ending - never cut mid-thought.
- Lasts ${DEFAULT_RULES.minSeconds}-${DEFAULT_RULES.maxSeconds} seconds.
Prefer fewer, stronger clips over many mediocre ones. Clips must not overlap.
Score honestly: 0.9+ is exceptional and rare. Use only timestamps present in the transcript.`;

/** One line per segment: "[123.4-129.0] text" */
function formatTranscript(t: Transcript): string {
  return t.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n");
}

export async function suggestClips(t: Transcript): Promise<{ raw: Clip[]; clips: Clip[] }> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    // Structured outputs: the response is JSON matching ClipsResponseSchema.
    // (Forcing a tool call with tool_choice is rejected by claude-sonnet-5-5.)
    output_config: { format: zodOutputFormat(ClipsResponseSchema) },
    messages: [
      {
        role: "user",
        content: `Video duration: ${t.duration.toFixed(0)}s\n\nTranscript:\n${formatTranscript(t)}`,
      },
    ],
  });

  if (res.stop_reason === "refusal") throw new Error("Model declined to suggest clips");
  if (!res.parsed_output) throw new Error(`Model did not return clips (stop_reason: ${res.stop_reason})`);
  const raw = ClipsResponseSchema.parse(res.parsed_output).clips; // re-check score range etc.
  return { raw, clips: cleanClips(raw, t) };
}
