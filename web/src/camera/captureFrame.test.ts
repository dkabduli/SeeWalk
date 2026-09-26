import { describe, expect, it } from "vitest";
import { looksCovered, sceneChanged, type Frame } from "./captureFrame";

const frame = (brightness: number, contrast: number): Frame => ({ b64: "", brightness, contrast, at: 0 });

describe("looksCovered", () => {
  it("black frame is covered", () => expect(looksCovered(frame(5, 2))).toBe(true));
  it("finger over the lens (dim, flat, auto-exposed) is covered", () => expect(looksCovered(frame(45, 4))).toBe(true));
  it("real iPhone finger readings are covered", () => {
    for (const [b, c] of [[28, 7], [33, 8], [31, 8], [34, 10], [56, 8], [37, 6]]) expect(looksCovered(frame(b, c))).toBe(true);
  });
  it("real iPhone normal / dim / moving scenes are not covered", () => {
    for (const [b, c] of [[137, 65], [117, 38], [60, 27], [68, 26], [42, 15], [254, 1], [252, 7]]) expect(looksCovered(frame(b, c))).toBe(false);
  });
  it("normal street scene is not covered", () => expect(looksCovered(frame(120, 45))).toBe(false));
  it("bright blank wall / overcast sky is not covered", () => expect(looksCovered(frame(210, 3))).toBe(false));
  it("dim but detailed scene (shade) is not covered", () => expect(looksCovered(frame(50, 30))).toBe(false));
});

describe("sceneChanged", () => {
  const fill = (n: number) => new Uint8ClampedArray(1024).fill(n);

  it("a still picture is the same scene", () => {
    expect(sceneChanged(fill(80), fill(84))).toBe(false);
  });

  it("a step forward is a new scene", () => {
    expect(sceneChanged(fill(80), fill(100))).toBe(true);
  });

  it("the first picture is always new", () => {
    expect(sceneChanged(null, fill(80))).toBe(true);
  });
});
