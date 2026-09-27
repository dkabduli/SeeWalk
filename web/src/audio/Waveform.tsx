import { useEffect, useRef } from "react";
import { arrange, BARS, breathing, smooth } from "./levels";

/** hearing: the walker is talking (mic) · speaking: the voice is talking (speaker) · thinking: waiting */
export type WaveMode = "hearing" | "thinking" | "speaking";

const MIN = 0.16; // a silent bar is a short dash, never gone
// Analyser bands for speech sit around 0.25-0.8; spread that over the bar's full height
const lift = (v: number) => Math.min(1, Math.max(0, (v - 0.12) / 0.62)) ** 0.85;

function reducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** Five Siri-style bars driven by real sound. Moved straight on the DOM each frame (no React
 *  re-render), and still when the phone asks for reduced motion. */
export function Waveform({ mode, levels }: { mode: WaveMode; levels: () => number[] }) {
  const bars = useRef<(HTMLElement | null)[]>([]);
  const levelsRef = useRef(levels);
  useEffect(() => { levelsRef.current = levels; });

  useEffect(() => {
    const draw = (heights: number[]) =>
      bars.current.forEach((el, i) => {
        if (el) el.style.transform = `scaleY(${MIN + (1 - MIN) * (heights[i] ?? 0)})`;
      });
    if (reducedMotion()) {
      draw([0.35, 0.6, 0.8, 0.6, 0.35]);
      return;
    }
    let shown = new Array<number>(BARS).fill(0);
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const target = mode === "thinking"
        ? breathing((now - t0) / 1000)
        : arrange(levelsRef.current()).map(lift);
      shown = smooth(shown, target);
      draw(shown);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  return (
    <span className="wave" aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => <i key={i} ref={(el) => { bars.current[i] = el; }} />)}
    </span>
  );
}
