import { listen } from "../api/client";
import type { Lang, ListenResult } from "../api/types";
import { bandLevels } from "../audio/levels";

// Voice commands ("SeeWalk, what's ahead / what am I holding / what's blocking my path / read this /
// is it safe to cross?") without Safari's speech recognition (iOS answers `service-not-allowed`
// on some iPhones). We capture the mic ourselves, cut out the moments someone is speaking, and
// send each clip WITH the current camera frame to POST /listen: one Gemini call works out the
// command and answers it (~2 s). Silence is never sent.

const TARGET_RATE = 16000;   // what we send: 16 kHz mono WAV (~32 KB per second)
const PRE_ROLL_S = 0.4;      // keep a little audio from before the speech started ("See…")
const MAX_CLIP_S = 4;        // longest clip we send
const END_SILENCE_S = 0.7;   // this much quiet ends a clip
// Shorter bursts (a cough, a door, "yeah") are ignored. The name alone ("VisionCompanion") is ~0.8 s,
// so anything under 0.6 s of voice can't be a command and isn't worth a Gemini call.
const MIN_SPEECH_S = 0.6;
const WAKE_ACK_S = 0.55;     // this much voice → "someone is talking" (the on-screen bars)
// Voice-like sound: loud AND a zero-crossing rate in the range of speech. Hiss (wind, traffic,
// rain) crosses zero far more often; engine and road rumble far less. Only voiced blocks count
// toward MIN_SPEECH_S, so background noise alone never becomes a clip.
const VOICE_MIN_CROSSINGS_PER_S = 150;
const VOICE_MAX_CROSSINGS_PER_S = 6000;

/** Splits a live mic signal into speech clips using its loudness (voice activity detection).
 *  Pure logic, so it's unit-tested without a microphone. */
export class SpeechClipper {
  private floor = 0.005; // running estimate of background noise
  private pre: Float32Array[] = [];
  private preLen = 0;
  private rec: Float32Array[] | null = null;
  private recLen = 0;
  private loudLen = 0;   // voiced samples in the clip so far
  private quietLen = 0;
  private acked = false;
  private readonly rate: number;
  private readonly onClip: (clip: Float32Array) => void;
  private readonly onWake: (() => void) | undefined;

  constructor(rate: number, onClip: (clip: Float32Array) => void, onWake?: () => void) {
    this.rate = rate;
    this.onClip = onClip;
    this.onWake = onWake;
  }

  /** Throw away anything recorded so far (e.g. SeeWalk itself was talking). */
  reset() {
    this.pre = [];
    this.preLen = 0;
    this.rec = null;
    this.recLen = 0;
    this.loudLen = 0;
    this.quietLen = 0;
    this.acked = false;
  }

  /** Seconds of voice in the clip that was just emitted (for the caller's own decisions). */
  lastVoiceSeconds = 0;

  push(buf: Float32Array) {
    let sum = 0;
    let crossings = 0;
    for (let i = 0; i < buf.length; i++) {
      sum += buf[i] * buf[i];
      if (i > 0 && (buf[i] >= 0) !== (buf[i - 1] >= 0)) crossings++;
    }
    const rms = Math.sqrt(sum / buf.length);
    const loud = rms > Math.max(this.floor * 3, 0.01);
    const perSecond = (crossings * this.rate) / buf.length;
    const voiced = loud && perSecond >= VOICE_MIN_CROSSINGS_PER_S && perSecond <= VOICE_MAX_CROSSINGS_PER_S;

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
        this.loudLen = voiced ? buf.length : 0;
        this.quietLen = 0;
      }
      return;
    }

    this.rec.push(buf);
    this.recLen += buf.length;
    if (loud) {
      if (voiced) this.loudLen += buf.length;
      this.quietLen = 0;
      if (!this.acked && this.loudLen >= WAKE_ACK_S * this.rate) {
        this.acked = true;
        this.onWake?.();
      }
    } else {
      this.quietLen += buf.length;
    }
    if (this.quietLen >= END_SILENCE_S * this.rate || this.recLen >= MAX_CLIP_S * this.rate) {
      const enough = this.loudLen >= MIN_SPEECH_S * this.rate;
      this.lastVoiceSeconds = this.loudLen / this.rate;
      const clip = concat(this.rec, this.recLen);
      this.rec = null;
      this.recLen = 0;
      this.loudLen = 0;
      this.quietLen = 0;
      this.acked = false;
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

/** onCommand: called with the recognised command (intent !== "none").
 *  onDebug (optional): reports what was heard, errors and state, for testing on the phone.
 *  getFrame (optional): the current camera frame (base64 JPEG), sent with each clip.
 *  onChecking (optional): true each time a clip goes to the server (with its seconds of voice), false
 *  once none is being checked. Nothing is confirmed yet: it may be background talk.
 *  onNoCommand (optional): the clip was speech, but not a command.
 *  onWake (optional): speech has lasted long enough to be the name; the rest of the question follows. */
export function createVoiceCommand(
  onCommand: (command: ListenResult) => void,
  onDebug?: (msg: string) => void,
  getFrame?: () => string | null,
  onChecking?: (checking: boolean, voiceSeconds?: number) => void,
  onNoCommand?: () => void,
  onWake?: () => void,
) {
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
  // The mic's loudness per speech band, for the on-screen waveform while the walker talks
  let micMeter: { node: AnalyserNode; data: Uint8Array<ArrayBuffer>; rate: number } | null = null;

  /** Loudness of five speech bands (low → high, 0..1) the mic hears now; zeros when not listening. */
  function levels(): number[] {
    if (!micMeter) return [0, 0, 0, 0, 0];
    micMeter.node.getByteFrequencyData(micMeter.data);
    return bandLevels(micMeter.data, micMeter.rate, micMeter.node.fftSize);
  }

  /** Tell the listener when SeeWalk is making sound (AudioEngine.onSounding). */
  function setSpeaking(on: boolean) {
    speaking = on;
    if (on) clipperRef?.reset();
    else quietSince = Date.now();
  }

  // Held while SeeWalk handles a question (from "command recognised" until the answer has been
  // spoken): new speech is ignored so one question gets one answer, uninterrupted.
  let held = false;
  function hold(on: boolean) {
    held = on;
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
    // The waveform's meter is optional: if it can't be made, listening works exactly as before
    let meter: AnalyserNode | null = null;
    try {
      meter = ctx.createAnalyser();
      Object.assign(meter, { fftSize: 512, smoothingTimeConstant: 0.5, minDecibels: -75, maxDecibels: -20 });
    } catch { meter = null; }
    const cleanup = () => {
      proc.onaudioprocess = null;
      if (meter && micMeter?.node === meter) micMeter = null;
      source.disconnect();
      meter?.disconnect();
      proc.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    };
    if (!s.active) { cleanup(); return; } // stopped while the permission prompt was open
    s.stop = () => { s.active = false; cleanup(); };

    // Up to two clips are checked at once. In the testers' walk, 9 clips were thrown away because
    // an earlier one (often background talk) was still being checked, and one was a real question.
    // The one-answer rule below (3 s) still stops two clips from both answering.
    const MAX_CHECKING = 2;
    let checking = 0;
    const clipper = new SpeechClipper(ctx.sampleRate, (clip) => {
      if (checking >= MAX_CHECKING) { onDebug?.("speech ignored (two already being checked)"); return; }
      checking += 1;
      onChecking?.(true, clipper.lastVoiceSeconds);
      const seconds = (clip.length / ctx.sampleRate).toFixed(1);
      onDebug?.(`speech ${seconds} s → checking`);
      listen(toBase64(encodeWav(downsample(clip, ctx.sampleRate), TARGET_RATE)), lang, getFrame?.() ?? null)
        .then((r) => {
          if (!s.active) return;
          onDebug?.(`heard "${r.heard}"${r.intent !== "none" ? ` → ${r.intent}${r.answer ? `: ${r.answer}` : ""}` : ""}`);
          if (r.intent !== "none" && Date.now() - lastFired > 3000) { // one question → one answer
            lastFired = Date.now();
            onCommand(r);
          } else if (r.intent === "none" && checking === 1) {
            onNoCommand?.(); // only the last clip back decides; another may still be the question
          }
        })
        .catch((e: Error) => onDebug?.(`error: ${e.message}`))
        .finally(() => {
          checking -= 1;
          if (checking === 0) onChecking?.(false); // "checking" ends when the last clip is done
        });
    }, onWake);

    clipperRef = clipper;
    proc.onaudioprocess = (e) => {
      if (!s.active) return;
      if (held || speaking || Date.now() - quietSince < ECHO_TAIL_MS) { clipper.reset(); return; }
      clipper.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    if (meter) {
      source.connect(meter); // the meter passes the mic through unchanged
      meter.connect(proc);
      micMeter = { node: meter, data: new Uint8Array(meter.frequencyBinCount), rate: ctx.sampleRate };
    } else {
      source.connect(proc);
    }
    proc.connect(ctx.destination); // Safari only runs the processor when it's connected; it outputs silence
    await ctx.resume().catch(() => {});
    onDebug?.(`listening (${ctx.state}, ${ctx.sampleRate} Hz)`);
  }

  function stop() {
    session?.stop();
    session = null;
  }

  return { supported, start, stop, setSpeaking, hold, levels };
}
