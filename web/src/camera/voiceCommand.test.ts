import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceCommand } from "./voiceCommand";

/** Minimal stand-in for Safari's webkitSpeechRecognition. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  started = 0;
  aborted = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.started++; }
  abort() { this.aborted = true; this.onend?.(); }
  say(text: string) {
    this.onresult?.({ results: [[{ transcript: text }]] });
  }
}
const last = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.instances = [];
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe("createVoiceCommand", () => {
  it("fires on 'SeeWalk, what's ahead?' in English", () => {
    const cb = vi.fn();
    const voice = createVoiceCommand(cb);
    expect(voice.supported).toBe(true);
    voice.start("en");
    expect(last().lang).toBe("en-CA");
    last().say("SeeWalk, what's ahead?");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("accepts the ways dictation spells 'SeeWalk'", () => {
    for (const heard of ["see walk what's ahead", "Sea walk, what's ahead", "seawalk what is in front of me", "C walk what's ahead"]) {
      const cb = vi.fn();
      createVoiceCommand(cb).start("en");
      last().say(heard);
      expect(cb, heard).toHaveBeenCalledTimes(1);
    }
  });

  it("needs the wake word: plain 'What's ahead?' or conversation doesn't fire", () => {
    const cb = vi.fn();
    createVoiceCommand(cb).start("en");
    for (const heard of ["What's ahead?", "what is in front of me", "I walked ahead of them", "see you ahead"]) last().say(heard);
    expect(cb).not.toHaveBeenCalled();
  });

  it("never fires on SeeWalk's own alerts leaking from open-ear headphones", () => {
    const cb = vi.fn();
    createVoiceCommand(cb).start("en");
    for (const phrase of ["Pothole ahead", "Person ahead, left", "Stop sign ahead", "Obstacle in your path", "Car on your right"]) {
      last().say(phrase);
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it("French: fires on 'SeeWalk, qu'y a-t-il devant ?'", () => {
    const cb = vi.fn();
    createVoiceCommand(cb).start("fr");
    expect(last().lang).toBe("fr-CA");
    last().say("SeeWalk, qu’y a-t-il devant ?");
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3500);
    last().say("see walk qu'est-ce qu'il y a devant");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("French: never fires on alerts like 'Voiture qui approche devant'", () => {
    const cb = vi.fn();
    createVoiceCommand(cb).start("fr");
    for (const phrase of ["Voiture qui approche devant", "Personne devant", "Passage pour piétons devant", "Panneau d'arrêt devant"]) {
      last().say(phrase);
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it("one question → one answer (3 s debounce)", () => {
    const cb = vi.fn();
    createVoiceCommand(cb).start("en");
    last().say("seewalk what's ahead");
    last().say("seewalk what's ahead");
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3100);
    last().say("seewalk what's ahead");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("restarts listening when iOS stops it, but not after stop()", () => {
    const voice = createVoiceCommand(vi.fn());
    voice.start("en");
    const rec = last();
    expect(rec.started).toBe(1);
    rec.onend?.();                     // iOS ended the session after silence
    vi.advanceTimersByTime(400);
    expect(rec.started).toBe(2);

    voice.stop();
    expect(rec.aborted).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(rec.started).toBe(2);       // no restart after stop
  });

  it("gives up restarting when the mic is refused", () => {
    const voice = createVoiceCommand(vi.fn());
    voice.start("en");
    const rec = last();
    rec.onerror?.({ error: "not-allowed" });
    rec.onend?.();
    vi.advanceTimersByTime(1000);
    expect(rec.started).toBe(1);
  });

  it("switching language replaces the recognizer", () => {
    const voice = createVoiceCommand(vi.fn());
    voice.start("en");
    const en = last();
    voice.start("fr");
    expect(en.aborted).toBe(true);
    expect(last().lang).toBe("fr-CA");
    vi.advanceTimersByTime(1000);
    expect(en.started).toBe(1);        // the old English one is not restarted
  });

  it("reports unsupported browsers instead of crashing", () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const voice = createVoiceCommand(vi.fn());
    expect(voice.supported).toBe(false);
    expect(voice.start("en")).toBe(false);
  });
});
