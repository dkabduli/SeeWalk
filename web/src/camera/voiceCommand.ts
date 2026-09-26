import type { Lang } from "../api/types";

// Wake phrase: "SeeWalk, what's ahead?" (FR: "SeeWalk, qu'y a-t-il devant ?").
// The wake word means nearby conversations and SeeWalk's own alerts leaking out of open-ear
// headphones can never trigger it. Dictation often splits or mishears "SeeWalk", so accept those.
const WAKE = ["seewalk", "see walk", "sea walk", "seawalk", "see-walk", "c walk", "si walk"];
const ASK: Record<Lang, string[]> = {
  en: ["ahead", "front"],
  fr: ["devant"],
};

/** onDebug (optional): reports what was heard, errors and restarts, for testing on the phone. */
export function createVoiceCommand(onCommand: () => void, onDebug?: (msg: string) => void) {
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
      const hit = WAKE.some((w) => text.includes(w)) && ASK[lang].some((w) => text.includes(w));
      onDebug?.(`heard "${text}"${hit ? " → trigger" : ""}`);
      if (hit && Date.now() - lastFired > 3000) { // one question → one answer
        lastFired = Date.now();
        onCommand();
      }
    };
    // iOS stops listening after silence or after we play audio: restart it
    rec.onend = () => {
      onDebug?.(active ? "ended, restarting" : "ended");
      if (active) setTimeout(() => { try { rec?.start(); } catch { /* already running */ } }, 300);
    };
    rec.onstart = () => onDebug?.("listening");
    rec.onerror = (e: any) => {
      if (e.error === "aborted") return; // we stopped it ourselves (Stop / language switch)
      console.warn("voice command:", e.error);
      onDebug?.(`error: ${e.error}`);
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
