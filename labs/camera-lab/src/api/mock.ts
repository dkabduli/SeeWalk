import type { Lang, SceneResult } from "./types";

const samples: Record<Lang, SceneResult[]> = {
  en: [
    { hazards: [], unclear: false },
    { hazards: [{ type: "stop_sign", direction: "ahead", distance: "near", urgency: 3, confidence: 0.93, approaching: false, phrase: "Stop sign ahead" }], unclear: false },
    { hazards: [{ type: "car", direction: "right", distance: "near", urgency: 1, confidence: 0.91, approaching: true, phrase: "Car on your right" }], unclear: false },
    { hazards: [], unclear: true },
  ],
  fr: [
    { hazards: [], unclear: false },
    { hazards: [{ type: "stop_sign", direction: "ahead", distance: "near", urgency: 3, confidence: 0.93, approaching: false, phrase: "Panneau d'arrêt devant" }], unclear: false },
    { hazards: [{ type: "car", direction: "right", distance: "near", urgency: 1, confidence: 0.91, approaching: true, phrase: "Voiture à droite" }], unclear: false },
    { hazards: [], unclear: true },
  ],
};
let i = 0;

export async function mockAnalyze(lang: Lang): Promise<SceneResult> {
  await new Promise((r) => setTimeout(r, 1200)); // pretend Gemini takes 1.2 s
  return samples[lang][i++ % samples[lang].length];
}
