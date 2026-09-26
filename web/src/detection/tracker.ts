import clips from "../audio/clips.json";
import type { Hazard, Lang } from "../api/types";

// Pure logic for the fast layer: turns COCO-SSD boxes into hazards. No TensorFlow here,
// so every rule is unit-tested without a camera or a model.

export type FastType = "person" | "bike" | "car";

/** COCO-SSD class → our hazard type. Everything else (chairs, dogs, ...) is Gemini's job. */
export const CLASS_TO_TYPE: Record<string, FastType> = {
  person: "person",
  bicycle: "bike",
  motorcycle: "bike",
  car: "car",
  truck: "car",
  bus: "car",
};

export interface Detection {
  type: FastType;
  box: [number, number, number, number]; // x, y, width, height in video pixels
  score: number;
}

interface Track {
  id: number;
  type: FastType;
  box: Detection["box"];
  seen: { t: number; area: number }[]; // recent sizes, to tell if it's getting closer
  lastSeen: number;
  announced: 0 | 1 | 2; // most urgent level already reported for this object (0 = not yet)
}

const MATCH_IOU = 0.25;        // same object if the boxes overlap this much between checks
const FORGET_MS = 1000;        // drop objects not seen for this long
const APPROACH_WINDOW_MS = 600; // compare size now vs ~0.6 s ago
const APPROACH_GROWTH = 1.2;    // 20 % bigger in that time = coming toward the walker
const CLOSE_HEIGHT = 0.6;       // box taller than 60 % of the frame = close
const NEAR_HEIGHT = 0.3;

function iou(a: Detection["box"], b: Detection["box"]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** Follows each person/bike/car from one check to the next and reports the ones that matter. */
export class FastTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  /** One detection pass → hazards worth announcing (approaching or close). */
  update(dets: Detection[], frameW: number, frameH: number, t: number, lang: Lang): Hazard[] {
    const unmatched = new Set(this.tracks);
    const hazards: Hazard[] = [];

    for (const d of [...dets].sort((a, b) => b.score - a.score)) {
      let best: Track | null = null;
      let bestIou = MATCH_IOU;
      for (const tr of unmatched) {
        if (tr.type !== d.type) continue;
        const o = iou(tr.box, d.box);
        if (o > bestIou) { best = tr; bestIou = o; }
      }
      const area = d.box[2] * d.box[3];
      let track: Track;
      if (best) {
        unmatched.delete(best);
        track = best;
        track.box = d.box;
        track.lastSeen = t;
        track.seen.push({ t, area });
        track.seen = track.seen.filter((s) => t - s.t <= APPROACH_WINDOW_MS * 2);
      } else {
        track = { id: this.nextId++, type: d.type, box: d.box, seen: [{ t, area }], lastSeen: t, announced: 0 };
        this.tracks.push(track);
      }

      const past = track.seen.find((s) => t - s.t >= APPROACH_WINDOW_MS);
      const approaching = !!past && area >= past.area * APPROACH_GROWTH;
      const heightRatio = d.box[3] / frameH;
      const distance = heightRatio > CLOSE_HEIGHT ? "close" : heightRatio > NEAR_HEIGHT ? "near" : "far";
      // Far objects are Gemini's job: tiny boxes jitter, which looks like "growing" (iPhone test:
      // distant passers-by were flagged as approaching). Otherwise: only what's coming at you,
      // or right there.
      if (distance === "far" || (!approaching && distance !== "close")) continue;
      const urgency: 1 | 2 = approaching && distance === "close" ? 1 : 2;
      // Say each object once, and again only if it becomes urgent (iPhone test: one person
      // walking past was announced as ahead, then left, then right).
      if (track.announced !== 0 && urgency >= track.announced) continue;
      track.announced = urgency;

      const cx = (d.box[0] + d.box[2] / 2) / frameW;
      const direction = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "ahead";
      const key = `${d.type}_${direction}`;
      hazards.push({
        type: d.type,
        direction,
        distance,
        approaching,
        urgency,
        confidence: d.score,
        // Exactly the bundled clip's text, so Jibril's speak() plays the clip instantly (no /tts)
        phrase: (clips as Record<string, Record<Lang, string>>)[key][lang],
      });
    }

    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= FORGET_MS);
    return hazards;
  }

  reset() {
    this.tracks = [];
  }
}
