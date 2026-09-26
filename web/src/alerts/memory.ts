import type { Lang, SceneResult } from "../api/types";

const WINDOW_MS = 30_000;
// The look we are answering with is not "something you passed".
const CURRENT_MS = 2_500;
const FILLER = new Set([
  "ahead", "left", "right", "your", "on", "the", "a", "an", "was", "were", "where",
  "devant", "gauche", "droite", "était", "etait", "vous", "avez", "passé", "passe",
  "see", "walk", "seewalk", "this", "that", "what", "whats",
]);

export interface MemoryNote {
  at: number;
  text: string;
}

/** Last 30 seconds of spoken alerts and one-line scenes. Questions read it. The walk does not. */
export class WalkMemory {
  private notes: MemoryNote[] = [];

  add(text: string, now = Date.now()) {
    const clean = text.trim().replace(/\.$/, "");
    if (!clean) return;
    const last = this.notes[this.notes.length - 1];
    if (last && last.text.toLowerCase() === clean.toLowerCase()) {
      last.at = now;
      return;
    }
    this.notes.push({ at: now, text: clean });
    this.prune(now);
  }

  remember(result: SceneResult, now = Date.now()) {
    for (const h of result.hazards) {
      if (h.confidence >= 0.6 && h.phrase.trim()) this.add(h.phrase, now);
    }
    if (result.summary?.trim()) this.add(result.summary, now);
  }

  /** One past clause that is not already in the answer. Empty if the last 30 s has nothing else. */
  aside(lead: string, lang: Lang, now = Date.now()): string {
    this.prune(now);
    const used = words(lead);
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const note = this.notes[i];
      if (now - note.at < CURRENT_MS) continue;
      if (shares(words(note.text), used)) continue;
      return was(note.text, lang);
    }
    return "";
  }

  /** "Where was the elevator?" from the notes. A miss is a plain sentence, never "clear" or "safe". */
  where(heard: string, lang: Lang, now = Date.now()): string {
    this.prune(now);
    const asked = words(heard);
    const hit = [...this.notes].reverse().find((n) => shares(words(n.text), asked));
    if (!hit) {
      return lang === "fr"
        ? "Je ne l'ai pas noté ces dernières secondes"
        : "I didn't note that in the last few seconds";
    }
    return was(hit.text, lang);
  }

  private prune(now: number) {
    this.notes = this.notes.filter((n) => now - n.at <= WINDOW_MS);
  }
}

/** Lead sentence, then one memory clause when it still fits. */
export function withAside(lead: string, aside: string, cap = 22): string {
  if (!aside) return lead;
  if (!lead) return aside;
  const next = `${lead}. ${aside}`;
  return next.trim().split(/\s+/).filter(Boolean).length <= cap ? next : lead;
}

function shares(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3 && !FILLER.has(w)),
  );
}

function was(phrase: string, lang: Lang): string {
  if (lang === "fr") {
    const next = phrase
      .replace(/\bdevant\b/i, "était devant")
      .replace(/\bà gauche\b/i, "était à gauche")
      .replace(/\bà droite\b/i, "était à droite");
    return next === phrase ? `Vous avez passé ${phrase}` : next;
  }
  const verb = /s$/i.test(phrase.split(/\s+/)[0] ?? "") ? "were" : "was";
  const next = phrase
    .replace(/\bahead\b/i, `${verb} ahead`)
    .replace(/\bon your left\b/i, `${verb} on your left`)
    .replace(/\bon your right\b/i, `${verb} on your right`)
    .replace(/\bon left\b/i, `${verb} on the left`)
    .replace(/\bon right\b/i, `${verb} on the right`);
  return next === phrase ? `You passed ${phrase}` : next;
}
