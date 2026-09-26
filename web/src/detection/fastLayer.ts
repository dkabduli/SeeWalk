import "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import type { Lang, SceneResult } from "../api/types";
import { CLASS_TO_TYPE, FastTracker, type Detection } from "./tracker";

// Fast layer: COCO-SSD on the phone spots people, bikes and cars ~4 times a second (~0.1–0.3 s),
// long before Gemini's ~1.5 s answer. Results go into the same onResult as Gemini's.
// Load with a dynamic import so TensorFlow.js (~1 MB) is only downloaded when it's used:
//   const { startFastLayer } = await import("../detection/fastLayer");

const TICK_MS = 250;

// The model download + GPU warm-up took ~19 s on first load in testing, so start it early:
// call preloadFastLayer() when the walk screen opens, and Start finds the model ready.
let modelPromise: Promise<cocoSsd.ObjectDetection> | null = null;
export function preloadFastLayer(): Promise<cocoSsd.ObjectDetection> {
  if (!modelPromise) {
    const t0 = performance.now();
    modelPromise = cocoSsd.load({ base: "lite_mobilenet_v2" }).then((m) => {
      console.info(`fast layer: model ready in ${Math.round(performance.now() - t0)} ms`);
      return m;
    });
    modelPromise.catch(() => { modelPromise = null; }); // allow a retry after a failed download
  }
  return modelPromise;
}

export interface FastLayerStats {
  loadMs: number;       // how long Start waited for the model (0 if it was preloaded)
  lastDetectMs: number; // time for the latest detection pass
}

/** Starts detecting on the (already playing) camera video. Resolves to a stop function. */
export async function startFastLayer(
  video: HTMLVideoElement,
  getLang: () => Lang,
  onResult: (r: SceneResult) => void,
  onStats?: (s: FastLayerStats) => void,
): Promise<() => void> {
  const t0 = performance.now();
  const model = await preloadFastLayer();
  // loadMs = how long Start actually waited (0 if preloaded in time)
  const stats: FastLayerStats = { loadMs: Math.round(performance.now() - t0), lastDetectMs: 0 };
  const tracker = new FastTracker();
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick() {
    if (!running) return;
    if (video.videoWidth && video.readyState >= 2 && !document.hidden) {
      try {
        const t = performance.now();
        const preds = await model.detect(video, 6, 0.5);
        stats.lastDetectMs = Math.round(performance.now() - t);
        onStats?.(stats);
        const dets: Detection[] = [];
        for (const p of preds) {
          const type = CLASS_TO_TYPE[p.class];
          if (type) dets.push({ type, box: p.bbox, score: p.score });
        }
        const hazards = tracker.update(dets, video.videoWidth, video.videoHeight, t, getLang());
        if (running && hazards.length) onResult({ hazards, unclear: false });
      } catch (e) {
        console.warn("fast layer: detection failed, will retry", e); // one bad frame must not stop it
      }
    }
    if (running) timer = setTimeout(tick, TICK_MS);
  }
  onStats?.(stats);
  void tick();

  return () => {
    running = false;
    clearTimeout(timer);
    tracker.reset(); // keep the model loaded for the next Start
  };
}
