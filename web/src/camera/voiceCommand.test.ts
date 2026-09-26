import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListenResult } from "../api/types";

const listenCalls: { audio: string; lang: string; resolve: (r: ListenResult) => void; reject: (e: Error) => void }[] = [];
vi.mock("../api/client", () => ({
  listen: vi.fn((audio: string, lang: string) =>
    new Promise<ListenResult>((resolve, reject) => listenCalls.push({ audio, lang, resolve, reject }))),
}));

import { createVoiceCommand, downsample, encodeWav, SpeechClipper } from "./voiceCommand";

const RATE = 48000;
const BLOCK = 4096; // what the ScriptProcessor delivers, ~85 ms at 48 kHz
const quiet = () => new Float32Array(BLOCK).map(() => (Math.random() - 0.5) * 0.004);
const speech = () => new Float32Array(BLOCK).map((_, i) => 0.3 * Math.sin(i / 8));
const blocks = (seconds: number) => Math.round((seconds * RATE) / BLOCK);

describe("SpeechClipper", () => {
  it("emits one clip for one sentence, including a bit of audio from before it", () => {
    const clips: Float32Array[] = [];
    const c = new SpeechClipper(RATE, (clip) => clips.push(clip));
    for (let i = 0; i < blocks(1); i++) c.push(quiet());
    for (let i = 0; i < blocks(1.2); i++) c.push(speech());   // "SeeWalk, what's ahead?"
    for (let i = 0; i < blocks(1); i++) c.push(quiet());
    expect(clips).toHaveLength(1);
    const seconds = clips[0].length / RATE;
    expect(seconds).toBeGreaterThan(1.2 + 0.3);                  // speech + pre-roll + trailing quiet
    expect(seconds).toBeLessThan(1.2 + 0.4 + 0.7 + 0.2);
  });

  it("never sends silence or background noise", () => {
    const clips: Float32Array[] = [];
    const c = new SpeechClipper(RATE, (clip) => clips.push(clip));
    for (let i = 0; i < blocks(10); i++) c.push(quiet());
    expect(clips).toHaveLength(0);
  });

  it("ignores very short sounds (a cough, a door)", () => {
    const clips: Float32Array[] = [];
    const c = new SpeechClipper(RATE, (clip) => clips.push(clip));
    for (let i = 0; i < blocks(1); i++) c.push(quiet());
    c.push(speech());                                            // ~85 ms bang
    for (let i = 0; i < blocks(1); i++) c.push(quiet());
    expect(clips).toHaveLength(0);
  });

  it("cuts long talking into clips of at most 4 s", () => {
    const clips: Float32Array[] = [];
    const c = new SpeechClipper(RATE, (clip) => clips.push(clip));
    for (let i = 0; i < blocks(0.5); i++) c.push(quiet());
    for (let i = 0; i < blocks(9); i++) c.push(speech());
    expect(clips.length).toBeGreaterThanOrEqual(2);
    for (const clip of clips) expect(clip.length / RATE).toBeLessThanOrEqual(4.1);
  });
});

describe("audio encoding", () => {
  it("downsamples 48 kHz to 16 kHz", () => {
    expect(downsample(new Float32Array(48000), 48000).length).toBe(16000);
    const same = new Float32Array(10);
    expect(downsample(same, 16000)).toBe(same);
  });

  it("writes a valid 16 kHz mono 16-bit WAV", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
    const v = new DataView(wav.buffer);
    const str = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1);        // mono
    expect(v.getUint32(24, true)).toBe(16000);    // sample rate
    expect(v.getUint16(34, true)).toBe(16);       // bits
    expect(v.getUint32(40, true)).toBe(8);        // 4 samples × 2 bytes
    expect(v.getInt16(46, true)).toBe(32767);     // +1.0 clipped to max
    expect(v.getInt16(48, true)).toBe(-32768);    // -1.0
    expect(wav.length).toBe(44 + 8);
  });
});

// ---- the whole flow with a fake microphone ----

class FakeProcessor {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null = null;
  connect() { return this; }
  disconnect() {}
  feed(buf: Float32Array) { this.onaudioprocess?.({ inputBuffer: { getChannelData: () => buf } }); }
}
let proc: FakeProcessor;
let closed = 0;
class FakeAudioContext {
  sampleRate = RATE;
  state = "running";
  destination = {};
  resume() { return Promise.resolve(); }
  close() { closed++; return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { proc = new FakeProcessor(); return proc; }
}
const track = { stop: vi.fn() };
let grantMic: () => void;
let micMode: "grant" | "deny" | "manual" = "grant";

beforeEach(() => {
  listenCalls.length = 0;
  closed = 0;
  track.stop.mockClear();
  micMode = "grant";
  vi.stubGlobal("AudioContext", FakeAudioContext);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        micMode === "deny"
          ? Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }))
          : new Promise((resolve) => {
              grantMic = () => resolve({ getTracks: () => [track] });
              if (micMode === "grant") grantMic();
            }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const flush = () => new Promise((r) => setTimeout(r, 0));
async function say(seconds = 1.2) {
  for (let i = 0; i < blocks(0.5); i++) proc.feed(quiet());
  for (let i = 0; i < blocks(seconds); i++) proc.feed(speech());
  for (let i = 0; i < blocks(1); i++) proc.feed(quiet());
  await flush();
}

describe("createVoiceCommand", () => {
  it("sends each spoken sentence to /listen and fires on 'SeeWalk, what's ahead?'", async () => {
    const onCommand = vi.fn();
    const debug: string[] = [];
    const voice = createVoiceCommand(onCommand, (m) => debug.push(m));
    expect(voice.supported).toBe(true);
    expect(voice.start("fr")).toBe(true);
    await flush();
    await say();
    expect(listenCalls).toHaveLength(1);
    expect(listenCalls[0].lang).toBe("fr");
    expect(atob(listenCalls[0].audio).slice(0, 4)).toBe("RIFF"); // a real WAV file
    listenCalls[0].resolve({ heard: "SeeWalk, qu'y a-t-il devant ?", command: true });
    await flush();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(debug.some((m) => m.includes("→ trigger"))).toBe(true);
  });

  it("does nothing for other speech", async () => {
    const onCommand = vi.fn();
    createVoiceCommand(onCommand).start("en");
    await flush();
    await say();
    listenCalls[0].resolve({ heard: "Pothole ahead", command: false });
    await flush();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("checks one clip at a time", async () => {
    const debug: string[] = [];
    createVoiceCommand(vi.fn(), (m) => debug.push(m)).start("en");
    await flush();
    await say();
    await say();                       // second sentence while the first is still being checked
    expect(listenCalls).toHaveLength(1);
    expect(debug.some((m) => m.includes("ignored"))).toBe(true);
    listenCalls[0].resolve({ heard: "", command: false });
    await flush();
    await say();
    expect(listenCalls).toHaveLength(2);
  });

  it("one question → one answer (3 s debounce)", async () => {
    const onCommand = vi.fn();
    createVoiceCommand(onCommand).start("en");
    await flush();
    await say();
    listenCalls[0].resolve({ heard: "SeeWalk, what's ahead?", command: true });
    await flush();
    await say();
    listenCalls[1].resolve({ heard: "SeeWalk, what's ahead?", command: true });
    await flush();
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("stop() releases the microphone and ignores late answers", async () => {
    const onCommand = vi.fn();
    const voice = createVoiceCommand(onCommand);
    voice.start("en");
    await flush();
    await say();
    voice.stop();
    expect(track.stop).toHaveBeenCalled();
    listenCalls[0].resolve({ heard: "SeeWalk, what's ahead?", command: true });
    await flush();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("stop() during the mic permission prompt releases the mic when it's granted", async () => {
    micMode = "manual";
    const voice = createVoiceCommand(vi.fn());
    voice.start("en");
    voice.stop();
    grantMic();
    await flush();
    expect(track.stop).toHaveBeenCalled();
  });

  it("reports a denied microphone instead of failing silently", async () => {
    micMode = "deny";
    const debug: string[] = [];
    createVoiceCommand(vi.fn(), (m) => debug.push(m)).start("en");
    await flush();
    expect(debug).toContain("error: microphone NotAllowedError");
  });

  it("reports server errors", async () => {
    const debug: string[] = [];
    createVoiceCommand(vi.fn(), (m) => debug.push(m)).start("en");
    await flush();
    await say();
    listenCalls[0].reject(new Error("listen 503"));
    await flush();
    expect(debug).toContain("error: listen 503");
  });

  it("switching language restarts listening in the new language", async () => {
    const voice = createVoiceCommand(vi.fn());
    voice.start("en");
    await flush();
    voice.start("fr");
    await flush();
    expect(track.stop).toHaveBeenCalledTimes(1);   // the English session let go of the mic
    await say();
    expect(listenCalls[0].lang).toBe("fr");
  });

  it("doesn't listen to SeeWalk's own voice (no echo clips)", async () => {
    const voice = createVoiceCommand(vi.fn());
    voice.start("en");
    await flush();
    voice.setSpeaking(true);          // SeeWalk says "Stop sign ahead" through the speaker
    await say();
    expect(listenCalls).toHaveLength(0);
    voice.setSpeaking(false);
    await say();                      // right after: still inside the echo tail
    expect(listenCalls).toHaveLength(0);
    const later = Date.now() + 1000;
    const spy = vi.spyOn(Date, "now").mockReturnValue(later);
    await say();                      // the walker speaks after SeeWalk finished
    expect(listenCalls).toHaveLength(1);
    spy.mockRestore();
  });

  it("a sentence cut off by SeeWalk starting to talk is thrown away, not sent half", async () => {
    const voice = createVoiceCommand(vi.fn());
    voice.start("en");
    await flush();
    for (let i = 0; i < blocks(0.5); i++) proc.feed(quiet());
    for (let i = 0; i < blocks(0.6); i++) proc.feed(speech());
    voice.setSpeaking(true);          // SeeWalk starts talking over the walker
    for (let i = 0; i < blocks(1.5); i++) proc.feed(speech());
    for (let i = 0; i < blocks(1); i++) proc.feed(quiet());
    await flush();
    expect(listenCalls).toHaveLength(0);
  });

  it("reports unsupported browsers instead of crashing", () => {
    vi.stubGlobal("AudioContext", undefined);
    const voice = createVoiceCommand(vi.fn());
    expect(voice.supported).toBe(false);
    expect(voice.start("en")).toBe(false);
    expect(closed).toBe(0);
  });
});
