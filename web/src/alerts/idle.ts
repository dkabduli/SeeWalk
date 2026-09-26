import type { Lang } from "../api/types";

const QUIET_MS = 10_000;
const NEXT_MS = 30_000;

/** One calm sentence from the scene summary. Empty when there is nothing to describe. */
export function paintScene(summary: string, lang: Lang): string {
  let s = summary.trim().replace(/[.!?]+$/g, "");
  if (!s) return "";
  if (/\b(safe|clear|sécuritaire|securitaire)\b/i.test(s)) return "";
  const words = s.split(/\s+/);
  if (words.length > 14) s = words.slice(0, 14).join(" ");
  const body = s.charAt(0).toLowerCase() + s.slice(1);
  return lang === "fr" ? `Devant vous, ${body}.` : `Before you, ${body}.`;
}

/** After 10 s with no alert, one description. The same place is not said again. */
export function nextIdleLine(
  now: number,
  quietSince: number,
  lastIdleAt: number,
  lastLine: string,
  summary: string,
  lang: Lang,
): string | null {
  if (now - quietSince < QUIET_MS) return null;
  if (lastIdleAt > 0 && now - lastIdleAt < NEXT_MS) return null;
  const line = paintScene(summary, lang);
  if (!line || samePlace(line, lastLine)) return null;
  return line;
}

function samePlace(a: string, b: string): boolean {
  const left = content(a);
  const right = content(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared += 1;
  return shared / Math.min(left.size, right.size) >= 0.6;
}

function content(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3),
  );
}
