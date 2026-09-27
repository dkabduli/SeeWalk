/** Bar heights for the Siri-style waveform, from real audio (the walker's mic, or the voice).
 *  Pure functions, so they're tested without audio hardware. Levels are 0..1. */

export const BARS = 5;

// Speech energy sits between ~150 Hz and ~4 kHz. Five bands, spaced like hearing (wider up high).
const EDGES_HZ = [150, 320, 650, 1200, 2200, 4000];

/** Average loudness of each band, from an AnalyserNode's byte frequency data (0..255 per bin). */
export function bandLevels(freq: ArrayLike<number>, sampleRate: number, fftSize: number): number[] {
  const hzPerBin = sampleRate / fftSize;
  const out: number[] = [];
  for (let b = 0; b < EDGES_HZ.length - 1; b++) {
    const lo = Math.max(1, Math.ceil(EDGES_HZ[b] / hzPerBin));   // bands meet without overlapping
    const hi = Math.min(freq.length - 1, Math.max(lo, Math.ceil(EDGES_HZ[b + 1] / hzPerBin) - 1));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += freq[i];
    out.push(sum / (hi - lo + 1) / 255);
  }
  return out;
}

/** Siri layout: the strongest (lowest) bands in the middle, higher ones toward the edges.
 *  Bands 0..4 (low → high) become bars [3, 1, 0, 2, 4]. */
export function arrange(bands: number[]): number[] {
  return [bands[3], bands[1], bands[0], bands[2], bands[4]];
}

/** Rises fast and falls gently, so the bars follow syllables without flickering. */
export function smooth(prev: number[], target: number[], attack = 0.55, release = 0.18): number[] {
  return target.map((t, i) => {
    const p = prev[i] ?? 0;
    return p + (t - p) * (t > p ? attack : release);
  });
}

/** "Thinking": no audio to show, so a slow breathing wave, tallest in the middle. t in seconds. */
export function breathing(t: number): number[] {
  return Array.from({ length: BARS }, (_, i) => {
    const centre = 1 - Math.abs(i - 2) * 0.18;
    return (0.28 + 0.22 * Math.sin(t * Math.PI * 2 * 0.9 - i * 0.75)) * centre;
  });
}
