import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./AudioEngine";

/** A stand-in for the browser's speechSynthesis: records what was said and lets the test end it. */
function fakeSpeech() {
  const said: { text: string; lang: string; u: SpeechSynthesisUtterance }[] = [];
  class Utterance {
    lang = "";
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    text: string;
    constructor(text: string) { this.text = text; }
  }
  const synth = {
    speak: vi.fn((u: SpeechSynthesisUtterance) => said.push({ text: u.text, lang: u.lang, u })),
    cancel: vi.fn(() => {
      for (const s of said.splice(0)) (s.u as unknown as Utterance).onerror?.({ error: "canceled" });
    }),
  };
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", synth);
  const end = () => (said.shift()!.u as unknown as Utterance).onend?.();
  return { said, synth, end };
}

afterEach(() => vi.unstubAllGlobals());

describe("speakText (phone voice when the live voice fails)", () => {
  it("says the answer in the walker's language and resolves true when it ends", async () => {
    const { said, end } = fakeSpeech();
    const a = new AudioEngine();
    const done = a.speakText("You're holding a water bottle", "fr");
    expect(said).toHaveLength(1);
    expect(said[0].text).toBe("You're holding a water bottle");
    expect(said[0].lang).toBe("fr-CA");
    end();
    await expect(done).resolves.toBe(true);
  });

  it("tells the mic it's speaking, and that it stopped", async () => {
    const { end } = fakeSpeech();
    const a = new AudioEngine();
    const sounding: boolean[] = [];
    a.onSounding = (on) => sounding.push(on);
    const done = a.speakText("Door ahead", "en");
    expect(sounding).toEqual([true]);
    end();
    await done;
    expect(sounding).toEqual([true, false]);
  });

  it("stop() cuts it off once, without leaving the mic paused", async () => {
    fakeSpeech();
    const a = new AudioEngine();
    const sounding: boolean[] = [];
    a.onSounding = (on) => sounding.push(on);
    const done = a.speakText("A long answer being read", "en");
    a.stop();
    await expect(done).resolves.toBe(true); // interrupted on purpose counts as handled
    expect(sounding).toEqual([true, false]);
  });

  it("resolves false where the browser has no built-in voice", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    const a = new AudioEngine();
    await expect(a.speakText("Anything", "en")).resolves.toBe(false);
  });
});
