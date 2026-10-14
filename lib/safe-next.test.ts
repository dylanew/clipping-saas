import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/projects/abc?x=1")).toBe("/projects/abc?x=1");
  });
  it("refuses other sites and falls back to home", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
