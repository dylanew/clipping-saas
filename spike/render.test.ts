import { describe, expect, it } from "vitest";
import { buildCaptions } from "./render.js";

const words = Array.from({ length: 10 }, (_, i) => ({ word: ` w${i}`, start: 100 + i, end: 100.8 + i }));
const dialogue = (ass: string) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));

describe("buildCaptions", () => {
  it("groups words in threes with times relative to the clip start", () => {
    const lines = dialogue(buildCaptions(words, { start: 100, end: 106 }));
    expect(lines).toHaveLength(2); // words 0-5 fall inside the clip
    expect(lines[0]).toContain("0:00:00.00,0:00:03.00"); // held until the next caption starts
    expect(lines[0]).toMatch(/W0 W1 W2$/);
    expect(lines[1]).toMatch(/W3 W4 W5$/);
  });
  it("strips characters that would break ASS override tags", () => {
    const ass = buildCaptions([{ word: "{\\b1}hi", start: 0, end: 1 }], { start: 0, end: 5 });
    expect(dialogue(ass)[0]).toMatch(/,B1HI$/);
  });
});
