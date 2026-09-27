import { describe, expect, it } from "vitest";
import { arrange, bandLevels, BARS, breathing, smooth } from "./levels";

const RATE = 48000;
const FFT = 512; // 256 bins of 93.75 Hz

/** Fake analyser output: `level` (0..255) in the bins between lo and hi Hz, silence elsewhere. */
function spectrum(lo: number, hi: number, level = 255): Uint8Array {
  const bins = new Uint8Array(FFT / 2);
  for (let i = 0; i < bins.length; i++) {
    const hz = (i * RATE) / FFT;
    if (hz >= lo && hz < hi) bins[i] = level;
  }
  return bins;
}

describe("waveform levels", () => {
  it("silence is flat", () => {
    expect(bandLevels(new Uint8Array(FFT / 2), RATE, FFT)).toEqual([0, 0, 0, 0, 0]);
  });

  it("a low voice lights the low bands; a hiss lights the high ones", () => {
    const low = bandLevels(spectrum(150, 650), RATE, FFT);
    expect(low[0]).toBeGreaterThan(0.8);
    expect(low[1]).toBeGreaterThan(0.8);
    expect(low[4]).toBe(0);
    const high = bandLevels(spectrum(2200, 4000), RATE, FFT);
    expect(high[4]).toBeGreaterThan(0.8);
    expect(high[0]).toBe(0);
  });

  it("works at the iPhone's other mic rate (44.1 kHz)", () => {
    const levels = bandLevels(new Uint8Array(FFT / 2).fill(128), 44100, FFT);
    expect(levels).toHaveLength(BARS);
    levels.forEach((v) => expect(v).toBeCloseTo(128 / 255, 5));
  });

  it("Siri layout: the lowest band in the middle, the highest at the edge", () => {
    expect(arrange([10, 11, 12, 13, 14])).toEqual([13, 11, 10, 12, 14]);
  });

  it("rises fast, falls slowly", () => {
    const up = smooth([0, 0, 0, 0, 0], [1, 1, 1, 1, 1]);
    const down = smooth([1, 1, 1, 1, 1], [0, 0, 0, 0, 0]);
    expect(up[0]).toBeGreaterThan(0.5);   // a syllable shows at once
    expect(down[0]).toBeGreaterThan(0.8); // and fades over a few frames, no flicker
  });

  it("thinking breathes gently, tallest in the middle, never flat or full", () => {
    for (const t of [0, 0.3, 0.7, 1.1]) {
      const bars = breathing(t);
      expect(bars).toHaveLength(BARS);
      bars.forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(0.55); });
    }
    const avg = (i: number) => [0, 0.2, 0.4, 0.6, 0.8].reduce((s, t) => s + breathing(t)[i], 0);
    expect(avg(2)).toBeGreaterThan(avg(0));
  });
});
