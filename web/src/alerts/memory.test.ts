import { describe, expect, it } from "vitest";
import type { SceneResult } from "../api/types";
import { WalkMemory, withAside } from "./memory";

const scene = (phrase: string, summary = ""): SceneResult => ({
  hazards: [{
    type: "stairs_down", direction: "right", distance: "near", urgency: 2, confidence: 0.9,
    approaching: false, phrase,
  }],
  unclear: false,
  summary,
});

describe("walking memory", () => {
  it("what's ahead adds one past clause and does not repeat what is in front", () => {
    const memory = new WalkMemory();
    memory.add("Stairs on your right", 0);
    memory.add("Elevator ahead", 10_000);
    expect(memory.aside("Elevator ahead", "en", 12_000)).toBe("Stairs were on your right");
    expect(withAside("Elevator ahead", memory.aside("Elevator ahead", "en", 12_000)))
      .toBe("Elevator ahead. Stairs were on your right");
  });

  it("the picture being answered is not treated as something already passed", () => {
    const memory = new WalkMemory();
    memory.add("Stairs on your right", 0);
    memory.remember(scene("Door ahead", "Glass entrance"), 20_000);
    expect(memory.aside("Door ahead", "en", 20_000)).toBe("Stairs were on your right");
  });

  it("where was the elevator uses the note and does not ask for a new photo", () => {
    const memory = new WalkMemory();
    memory.add("Elevator ahead", 1_000);
    memory.add("Pillar ahead", 5_000);
    expect(memory.where("SeeWalk, where was the elevator?", "en", 8_000)).toBe("Elevator was ahead");
    memory.add("Ascenseur devant", 6_000);
    expect(memory.where("SeeWalk, où était l'ascenseur ?", "fr", 8_000)).toBe("Ascenseur était devant");
  });

  it("a note older than 30 seconds is gone", () => {
    const memory = new WalkMemory();
    memory.add("Elevator ahead", 0);
    expect(memory.where("where was the elevator", "en", 31_000)).toBe("I didn't note that in the last few seconds");
  });
});
