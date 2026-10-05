import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
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
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    // Forcing a tool call makes the model return JSON matching our schema.
    tools: [
      {
        name: "submit_clips",
        description: "Submit the selected clips, best first.",
        input_schema: z.toJSONSchema(ClipsResponseSchema) as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "submit_clips" },
    messages: [
      {
        role: "user",
        content: `Video duration: ${t.duration.toFixed(0)}s\n\nTranscript:\n${formatTranscript(t)}`,
      },
    ],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Model did not return clips");
  const raw = ClipsResponseSchema.parse(block.input).clips; // throws if shape is wrong
  return { raw, clips: cleanClips(raw, t) };
}
