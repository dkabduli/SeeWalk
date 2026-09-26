import { describe, expect, it } from "vitest";
import { looksCovered, type Frame } from "./captureFrame";

const frame = (brightness: number, contrast: number): Frame => ({ b64: "", brightness, contrast, at: 0 });

describe("looksCovered", () => {
  it("black frame is covered", () => expect(looksCovered(frame(5, 2))).toBe(true));
  it("finger over the lens (dim, flat, auto-exposed) is covered", () => expect(looksCovered(frame(45, 4))).toBe(true));
  it("normal street scene is not covered", () => expect(looksCovered(frame(120, 45))).toBe(false));
  it("bright blank wall / overcast sky is not covered", () => expect(looksCovered(frame(210, 3))).toBe(false));
  it("dim but detailed scene (shade) is not covered", () => expect(looksCovered(frame(50, 30))).toBe(false));
});
