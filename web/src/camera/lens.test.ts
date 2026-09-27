import { describe, expect, it } from "vitest";
import { mainBackCamera, tuning } from "./lens";

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
