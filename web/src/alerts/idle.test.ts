import { describe, expect, it } from "vitest";
import { nextIdleLine, paintScene } from "./idle";

describe("idle scene", () => {
  it("paints one sentence and never calls a place safe", () => {
    expect(paintScene("Wide sunlit sidewalk along the street", "en")).toBe("Before you, wide sunlit sidewalk along the street.");
    expect(paintScene("Un large trottoir", "fr")).toBe("Devant vous, un large trottoir.");
    expect(paintScene("The path is clear", "en")).toBe("");
    expect(paintScene("", "en")).toBe("");
  });

  it("waits 10 seconds, speaks once, and does not repeat the same place", () => {
    const summary = "A bright hall with a glass wall";
    expect(nextIdleLine(9_000, 0, 0, "", summary, "en")).toBeNull();
    const line = nextIdleLine(10_000, 0, 0, "", summary, "en");
    expect(line).toBe("Before you, a bright hall with a glass wall.");
    expect(nextIdleLine(20_000, 0, 10_000, line!, summary, "en")).toBeNull();
    expect(nextIdleLine(45_000, 0, 10_000, line!, "A bright hall and a glass wall", "en")).toBeNull();
  });

  it("a new place can be described after a later quiet stretch", () => {
    const first = "Before you, a bright hall with a glass wall.";
    const line = nextIdleLine(50_000, 0, 10_000, first, "Tree-lined sidewalk beside the road", "en");
    expect(line).toBe("Before you, tree-lined sidewalk beside the road.");
  });
});