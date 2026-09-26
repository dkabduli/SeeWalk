import type { Lang, SceneResult } from "./types";
import { mockAnalyze } from "./mock";

const BASE = "/api"; // Vite proxies /api → http://localhost:8000
export const MOCK = import.meta.env.VITE_MOCK_API === "1";
if (MOCK) console.warn("SeeWalk: MOCK API ON: results are fake. Remove VITE_MOCK_API before filming.");

export async function analyze(
  image: string,
  prevImage: string | null,
  lang: Lang,
  signal?: AbortSignal,
): Promise<SceneResult> {
  if (MOCK) return mockAnalyze(lang);
  const r = await fetch(`${BASE}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, prev_image: prevImage, lang }),
    signal,
  });
  if (!r.ok) throw new Error(`analyze ${r.status}`);
  return r.json();
}

/** Live speech. Gives up after 2.5 s so a stale alert is never spoken late. */
export async function tts(text: string, lang: Lang): Promise<ArrayBuffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(`${BASE}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`tts ${r.status}`);
    return await r.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}
