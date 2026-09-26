import type { Lang } from "../api/types";

// Each trigger lists words that must ALL appear. SeeWalk's own phrases (spoken by Gemini's
// "phrase" field, which can be free-form) leak out of open-ear headphones, so the triggers use
// question words our alerts never contain: "what" in English, "qu'y a" / "qu'est-ce" / "quoi" in French.
const TRIGGERS: Record<Lang, string[][]> = {
  en: [["what", "ahead"], ["what", "front"]],
  fr: [["qu'y a", "devant"], ["qu'est-ce", "devant"], ["quoi", "devant"]],
};

export function createVoiceCommand(onCommand: () => void) {
  const Recognition =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  let rec: any = null;
  let active = false;
  let lastFired = 0;

  function start(lang: Lang): boolean {
    if (!Recognition) return false;
    stop();
    active = true;
    rec = new Recognition();
    rec.lang = lang === "fr" ? "fr-CA" : "en-CA";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results[e.results.length - 1][0].transcript.toLowerCase().replace(/[’`]/g, "'");
      const hit = TRIGGERS[lang].some((words) => words.every((w) => text.includes(w)));
      if (hit && Date.now() - lastFired > 3000) { // one question → one answer
        lastFired = Date.now();
        onCommand();
      }
    };
    // iOS stops listening after silence or after we play audio: restart it
    rec.onend = () => {
      if (active) setTimeout(() => { try { rec?.start(); } catch { /* already running */ } }, 300);
    };
    rec.onerror = (e: any) => {
      if (e.error === "aborted") return; // we stopped it ourselves (Stop / language switch)
      console.warn("voice command:", e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") active = false; // mic refused: give up
    };
    rec.start();
    return true;
  }

  function stop() {
    active = false;
    rec?.abort();
    rec = null;
  }

  return { supported: !!Recognition, start, stop };
}
