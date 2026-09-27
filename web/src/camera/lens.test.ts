import { describe, expect, it } from "vitest";
import { mainBackCamera, nextLight, tuning, type Light } from "./lens";

const cams = (...labels: string[]) => labels.map((label, i) => ({ deviceId: `id${i}`, label }));

describe("main rear lens", () => {
  it("iPhone Pro (English): the plain Back Camera, not the lens-switching virtual ones", () => {
    const list = cams("Front Camera", "Back Triple Camera", "Back Dual Wide Camera", "Back Ultra Wide Camera",
      "Back Telephoto Camera", "Back Camera");
    expect(mainBackCamera(list)).toBe("id5");
  });

  it("iPhone in French", () => {
    const list = cams("Caméra avant", "Caméra triple arrière", "Caméra double grand-angle arrière",
      "Caméra ultra grand-angle arrière", "Caméra arrière");
    expect(mainBackCamera(list)).toBe("id4");
  });

  it("single-lens iPhone (SE): its only back camera", () => {
    expect(mainBackCamera(cams("Front Camera", "Back Camera"))).toBe("id1");
  });

  it("no names (before permission) or only front cameras: keep what iOS picked", () => {
    expect(mainBackCamera(cams("", ""))).toBeNull();
    expect(mainBackCamera(cams("Front Camera", "FaceTime HD Camera"))).toBeNull();
  });
});

describe("camera tuning", () => {
  it("continuous focus, exposure and white balance, and zoom at its minimum (never below 1x)", () => {
    expect(tuning({
      focusMode: ["manual", "single-shot", "continuous"],
      exposureMode: ["continuous"],
      whiteBalanceMode: ["manual", "continuous"],
      zoom: { min: 1, max: 10 },
    })).toEqual({ focusMode: "continuous", exposureMode: "continuous", whiteBalanceMode: "continuous", zoom: 1 });
    expect(tuning({ zoom: { min: 0.5, max: 5 } })).toEqual({ zoom: 1 });
  });

  it("asks for nothing the phone doesn't support", () => {
    expect(tuning({})).toEqual({});
    expect(tuning({ focusMode: ["manual"] })).toEqual({});
  });
});

describe("flashlight at night", () => {
  const run = (brightness: number[]) =>
    brightness.reduce<Light[]>((all, b) => [...all, nextLight(all.at(-1) ?? { on: false, dark: 0 }, b)], []);

  it("comes on after 3 dark snapshots in a row", () => {
    expect(run([30, 30]).at(-1)!.on).toBe(false);
    expect(run([30, 30, 30]).at(-1)!.on).toBe(true);
  });

  it("a passing shadow (one or two dark snapshots) doesn't turn it on", () => {
    expect(run([30, 30, 100, 30, 30, 100]).some((l) => l.on)).toBe(false);
  });

  it("once on, it stays on for the rest of the walk (no flicker)", () => {
    const states = run([20, 20, 20, 140, 200, 250, 30]);
    expect(states.slice(2).every((l) => l.on)).toBe(true);
  });

  it("an ordinary night street the phone can expose (brightness 60+) keeps it off", () => {
    expect(run([63, 75, 61, 94, 71]).some((l) => l.on)).toBe(false);
  });
});
