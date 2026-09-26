import { describe, expect, it } from "vitest";
import { clipUrl, isVoice } from "./voices";

describe("voices", () => {
  it("keeps River's clips where they already are, and gives the others their own folder", () => {
    expect(clipUrl("river", "en", "st_door_ahead")).toBe("/audio/en/st_door_ahead.mp3");
    expect(clipUrl("alice", "fr", "st_door_ahead")).toBe("/audio/alice/fr/st_door_ahead.mp3");
    expect(clipUrl("moyo", "en", "walk_started")).toBe("/audio/moyo/en/walk_started.mp3");
  });

  it("accepts only the four picker voices", () => {
    expect(isVoice("charlie")).toBe(true);
    expect(isVoice("river")).toBe(true);
    expect(isVoice("someone")).toBe(false);
    expect(isVoice(null)).toBe(false);
  });
});
