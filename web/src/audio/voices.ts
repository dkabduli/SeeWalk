import type { Lang } from "../api/types";

/** River is the voice the app shipped with. The other three are the picker. */
export const VOICES = [
  { id: "river", name: "River", place: { en: "North America", fr: "Amérique du Nord" } },
  { id: "alice", name: "Alice", place: { en: "Britain", fr: "Grande-Bretagne" } },
  { id: "charlie", name: "Charlie", place: { en: "Australia", fr: "Australie" } },
  { id: "moyo", name: "Moyo", place: { en: "Nigeria", fr: "Nigéria" } },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];

export const DEFAULT_VOICE: VoiceId = "river";
const KEY = "seewalk.voice";

export function isVoice(value: string | null): value is VoiceId {
  return VOICES.some((v) => v.id === value);
}

export function loadVoice(): VoiceId {
  try {
    const saved = localStorage.getItem(KEY);
    return isVoice(saved) ? saved : DEFAULT_VOICE;
  } catch {
    return DEFAULT_VOICE;
  }
}

export function saveVoice(id: VoiceId) {
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
}

/** River's clips already live at /audio/{lang}/. The others have their own folder. */
export function clipUrl(voice: VoiceId, lang: Lang, key: string): string {
  return voice === "river" ? `/audio/${lang}/${key}.mp3` : `/audio/${voice}/${lang}/${key}.mp3`;
}
