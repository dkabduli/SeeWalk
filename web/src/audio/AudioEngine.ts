import type { Lang } from "../api/types";
import clips from "./clips.json";
import { bandLevels } from "./levels";
import { clipUrl, DEFAULT_VOICE, type VoiceId } from "./voices";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private voice: VoiceId = DEFAULT_VOICE;
  private buffers = new Map<string, AudioBuffer>();
  private current: AudioBufferSourceNode | null = null;
  private sounding = 0;
  // Voice playback passes through this meter on its way out, for the on-screen waveform.
  private meter: AnalyserNode | null = null;
  private meterData: Uint8Array<ArrayBuffer> | null = null;
  private playingListeners = new Set<(on: boolean) => void>();

  /** Told when a voice (clip or live speech) starts and stops playing. Returns the unsubscribe. */
  onPlaying(listener: (on: boolean) => void): () => void {
    this.playingListeners.add(listener);
    return () => this.playingListeners.delete(listener);
  }
  private setPlaying(on: boolean) {
    this.playingListeners.forEach((l) => l(on));
  }

  /** Loudness of five speech bands (low → high, 0..1) of the voice playing now; zeros when silent. */
  levels(): number[] {
    if (!this.meter || !this.meterData || !this.ctx) return [0, 0, 0, 0, 0];
    this.meter.getByteFrequencyData(this.meterData);
    return bandLevels(this.meterData, this.ctx.sampleRate, this.meter.fftSize);
  }

  /** Where voices play to: through the waveform's meter, or straight out if it can't be made. */
  private output(): AudioNode {
    const ctx = this.ctx!;
    if (!this.meter) {
      try {
        this.meter = new AnalyserNode(ctx, { fftSize: 512, smoothingTimeConstant: 0.55, minDecibels: -80, maxDecibels: -22 });
        this.meterData = new Uint8Array(this.meter.frequencyBinCount);
        this.meter.connect(ctx.destination); // passes the sound through unchanged
      } catch {
        return ctx.destination; // the voice still plays; the bars just stay flat
      }
    }
    return this.meter;
  }

  /** Called with true when SeeWalk starts making sound and false when it stops, so the voice
   *  command can stop listening meanwhile (the mic otherwise hears SeeWalk's own voice). */
  onSounding: ((on: boolean) => void) | null = null;

  private soundStarted() {
    if (this.sounding++ === 0) this.onSounding?.(true);
  }
  private soundEnded() {
    if (this.sounding > 0 && --this.sounding === 0) this.onSounding?.(false);
  }

  /** Call inside the Start button's tap handler. iOS blocks audio until a user gesture. */
  async unlock() {
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
  }

  /** Which voice the bundled clips play in. Call before preload. */
  setVoice(voice: VoiceId) {
    this.voice = voice;
  }

  /** Decode the bundled clips for a language (all, or those `only` picks) so they play instantly. */
  async preload(lang: Lang, only: (key: string) => boolean = () => true) {
    const voice = this.voice;
    // allSettled: one missing clip must not break Start
    await Promise.allSettled(
      Object.keys(clips).filter(only).map(async (key) => {
        const id = `${voice}/${lang}/${key}`;
        if (this.buffers.has(id)) return;
        const res = await fetch(clipUrl(voice, lang, key));
        if (!res.ok) return;
        this.buffers.set(id, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
      }),
    );
  }

  // Voice samples on the setup screen play through a plain <audio> element, not Web Audio: on an
  // iPhone with the ring/silent switch on, Web Audio is muted until the mic is running (during a
  // walk it isn't, which is why the walk was audible but the samples were silent).
  private sample: HTMLAudioElement | null = null;

  /** Play one bundled clip in any voice (the voice cards). Call straight from the tap, with no
   *  await before it: iOS only lets media start inside the gesture. Resolves when it ends. */
  previewClip(voice: VoiceId, lang: Lang, key: string): Promise<void> {
    this.sample?.pause();
    this.stop();
    const el = new Audio(clipUrl(voice, lang, key));
    el.setAttribute("playsinline", "");
    this.sample = el;
    return el.play().then(
      () => new Promise<void>((resolve) => { el.onended = () => resolve(); el.onpause = () => resolve(); }),
    );
  }

  /** iOS suspends ("interrupts") the audio context after a call, Siri, or switching apps.
   *  Try to resume before every sound; if it stays suspended, the next tap resumes it. */
  private ensureRunning() {
    if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {});
  }

  hasClip(lang: Lang, key: string) {
    return this.buffers.has(`${this.voice}/${lang}/${key}`);
  }

  get busy() {
    return this.current !== null;
  }

  stop() {
    try { this.current?.stop(); } catch { /* already stopped */ }
    if (this.current) this.setPlaying(false);
    this.current = null;
  }

  /** A short tone. These cues stay off the "app is speaking" signal so the mic keeps the question. */
  private softNote(freq: number, at: number, ms: number, level: number) {
    const ctx = this.ctx!;
    const osc = new OscillatorNode(ctx, { frequency: freq, type: "sine" });
    const gain = new GainNode(ctx, { gain: 0.0001 });
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + ms / 1000 + 0.02);
  }

  /** Wake: a louder rising chime, like Siri, once the name has been heard. The question continues. */
  playWake() {
    if (!this.ctx) return;
    this.ensureRunning();
    const t = this.ctx.currentTime;
    this.softNote(784, t, 130, 0.46);          // G5
    this.softNote(1175, t + 0.11, 170, 0.5);   // D6
  }

  /** End of the question: a short falling chime. The mic ignores it so it is not a new command. */
  playDone() {
    if (!this.ctx) return;
    this.ensureRunning();
    const t = this.ctx.currentTime;
    this.softNote(1175, t, 90, 0.36);
    this.softNote(784, t + 0.09, 150, 0.32);
    this.soundStarted();
    setTimeout(() => this.soundEnded(), 300);
  }

  private workingTimer: ReturnType<typeof setInterval> | null = null;
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null;

  /** If the answer is still coming after the usual wait, sound an alert, then again until it arrives. */
  startWorking() {
    if (!this.ctx || this.workingTimer || this.thinkingTimer) return;
    this.ensureRunning();
    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = null;
      const pulse = () => {
        const now = this.ctx!.currentTime;
        this.softNote(880, now, 120, 0.4);
        this.softNote(880, now + 0.16, 120, 0.34);
      };
      pulse();
      this.workingTimer = setInterval(pulse, 1600);
    }, 3000);
  }

  stopWorking() {
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer);
    this.thinkingTimer = null;
    if (this.workingTimer) clearInterval(this.workingTimer);
    this.workingTimer = null;
  }

  /** Short beep placed in the left (-1), centre (0) or right (+1) ear. */
  playTone(pan: number, freq = 1000, ms = 120): Promise<void> {
    this.ensureRunning();
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = new OscillatorNode(ctx, { frequency: freq, type: "sine" });
    const gain = new GainNode(ctx, { gain: 0.0001 });
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(new StereoPannerNode(ctx, { pan })).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
    this.soundStarted();
    return new Promise((r) => setTimeout(() => { this.soundEnded(); r(); }, ms + 40));
  }

  async playSpeech(mp3: ArrayBuffer, pan = 0) {
    return this.playBuffer(await this.ctx!.decodeAudioData(mp3), pan);
  }

  playClip(lang: Lang, key: string, pan = 0) {
    const buf = this.buffers.get(`${this.voice}/${lang}/${key}`);
    return buf ? this.playBuffer(buf, pan) : Promise.resolve();
  }

  private playBuffer(buffer: AudioBuffer, pan: number): Promise<void> {
    this.stopWorking(); // the answer is here: the "working" pulse ends
    this.stop();
    this.ensureRunning();
    const ctx = this.ctx!;
    const src = new AudioBufferSourceNode(ctx, { buffer });
    src.connect(new StereoPannerNode(ctx, { pan })).connect(this.output());
    this.current = src;
    this.soundStarted();
    this.setPlaying(true);
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.current === src) {
          this.current = null;
          this.setPlaying(false); // not when a newer voice took over (it said true already)
        }
        this.soundEnded();
        resolve();
      };
      src.start();
    });
  }
}

export const audio = new AudioEngine();
