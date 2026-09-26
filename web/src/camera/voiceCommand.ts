import { listen } from "../api/client";
import type { Lang } from "../api/types";

// "SeeWalk, what's ahead?" without Safari's speech recognition (iOS answers `service-not-allowed`
// on some iPhones). We capture the mic ourselves, cut out the moments someone is speaking, and
// send each clip to POST /listen, where Gemini decides whether it was the command (~1.5 s).
// Silence is never sent.

const TARGET_RATE = 16000;   // what we send: 16 kHz mono WAV (~32 KB per second)
const PRE_ROLL_S = 0.4;      // keep a little audio from before the speech started ("See…")
const MAX_CLIP_S = 4;        // longest clip we send
const END_SILENCE_S = 0.7;   // this much quiet ends a clip
const MIN_SPEECH_S = 0.35;   // shorter bursts (a cough, a door) are ignored

/** Splits a live mic signal into speech clips using its loudness (voice activity detection).
 *  Pure logic, so it's unit-tested without a microphone. */
export class SpeechClipper {
  private floor = 0.005; // running estimate of background noise
  private pre: Float32Array[] = [];
  private preLen = 0;
  private rec: Float32Array[] | null = null;
  private recLen = 0;
  private loudLen = 0;
  private quietLen = 0;
  private readonly rate: number;
  private readonly onClip: (clip: Float32Array) => void;

  constructor(rate: number, onClip: (clip: Float32Array) => void) {
    this.rate = rate;
    this.onClip = onClip;
  }

  /** Throw away anything recorded so far (e.g. SeeWalk itself was talking). */
  reset() {
    this.pre = [];
    this.preLen = 0;
    this.rec = null;
    this.recLen = 0;
    this.loudLen = 0;
    this.quietLen = 0;
  }

  push(buf: Float32Array) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const loud = rms > Math.max(this.floor * 3, 0.01);

    if (!this.rec) {
      if (!loud) this.floor = this.floor * 0.95 + rms * 0.05;
      this.pre.push(buf);
      this.preLen += buf.length;
      while (this.pre.length > 1 && this.preLen - this.pre[0].length >= PRE_ROLL_S * this.rate) {
        this.preLen -= this.pre.shift()!.length;
      }
      if (loud) {
        this.rec = this.pre;
        this.recLen = this.preLen;
        this.pre = [];
        this.preLen = 0;
        this.loudLen = buf.length;
        this.quietLen = 0;
      }
      return;
    }

    this.rec.push(buf);
    this.recLen += buf.length;
    if (loud) {
      this.loudLen += buf.length;
      this.quietLen = 0;
    } else {
      this.quietLen += buf.length;
    }
    if (this.quietLen >= END_SILENCE_S * this.rate || this.recLen >= MAX_CLIP_S * this.rate) {
      const enough = this.loudLen >= MIN_SPEECH_S * this.rate;
      const clip = concat(this.rec, this.recLen);
      this.rec = null;
      this.recLen = 0;
      this.loudLen = 0;
      this.quietLen = 0;
      if (enough) this.onClip(clip);
    }
  }
}

function concat(parts: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

/** Average-and-drop resampling (e.g. the iPhone's 48 kHz → 16 kHz). Good enough for speech. */
export function downsample(input: Float32Array, inRate: number, outRate = TARGET_RATE): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** 16-bit PCM mono WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);      // fmt chunk size
  v.setUint16(20, 1, true);       // PCM
  v.setUint16(22, 1, true);       // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // bytes per second
  v.setUint16(32, 2, true);       // block align
  v.setUint16(34, 16, true);      // bits per sample
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface Session { active: boolean; stop: () => void }

/** onDebug (optional): reports what was heard, errors and state, for testing on the phone. */
export function createVoiceCommand(onCommand: () => void, onDebug?: (msg: string) => void) {
  const supported =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
  let session: Session | null = null;
  let lastFired = 0;
  // While SeeWalk is speaking (and a moment after, for echo), the mic is ignored: in the iPhone
  // test ~30 of ~200 clips were SeeWalk hearing itself ("Nothing detected. Stop lying ahead.").
  const ECHO_TAIL_MS = 400;
  let speaking = false;
  let quietSince = 0;
  let clipperRef: SpeechClipper | null = null;

  /** Tell the listener when SeeWalk is making sound (AudioEngine.onSounding). */
  function setSpeaking(on: boolean) {
    speaking = on;
    if (on) clipperRef?.reset();
    else quietSince = Date.now();
  }

  /** Call inside a tap: iOS only lets the audio context start from a user gesture. */
  function start(lang: Lang): boolean {
    if (!supported) return false;
    stop();
    const ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    const s: Session = { active: true, stop: () => { s.active = false; void ctx.close().catch(() => {}); } };
    session = s;
    void run(s, ctx, lang);
    return true;
  }

  async function run(s: Session, ctx: AudioContext, lang: Lang) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      onDebug?.(`error: microphone ${(e as Error).name}`);
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const cleanup = () => {
      proc.onaudioprocess = null;
      source.disconnect();
      proc.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    };
    if (!s.active) { cleanup(); return; } // stopped while the permission prompt was open
    s.stop = () => { s.active = false; cleanup(); };

    let checking = false; // one clip at a time
    const clipper = new SpeechClipper(ctx.sampleRate, (clip) => {
      if (checking) { onDebug?.("speech ignored (still checking the last one)"); return; }
      checking = true;
      const seconds = (clip.length / ctx.sampleRate).toFixed(1);
      onDebug?.(`speech ${seconds} s → checking`);
      listen(toBase64(encodeWav(downsample(clip, ctx.sampleRate), TARGET_RATE)), lang)
        .then((r) => {
          if (!s.active) return;
          onDebug?.(`heard "${r.heard}"${r.command ? " → trigger" : ""}`);
          if (r.command && Date.now() - lastFired > 3000) { // one question → one answer
            lastFired = Date.now();
            onCommand();
          }
        })
        .catch((e: Error) => onDebug?.(`error: ${e.message}`))
        .finally(() => { checking = false; });
    });

    clipperRef = clipper;
    proc.onaudioprocess = (e) => {
      if (!s.active) return;
      if (speaking || Date.now() - quietSince < ECHO_TAIL_MS) { clipper.reset(); return; }
      clipper.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(proc);
    proc.connect(ctx.destination); // Safari only runs the processor when it's connected; it outputs silence
    await ctx.resume().catch(() => {});
    onDebug?.(`listening (${ctx.state}, ${ctx.sampleRate} Hz)`);
  }

  function stop() {
    session?.stop();
    session = null;
  }

  return { supported, start, stop, setSpeaking };
}
