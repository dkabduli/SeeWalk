import type { Lang } from "../api/types";
import { bearing, metresBetween, sideOf, type LatLon, type Side } from "./geo";
import { fetchNear, type NearHazard } from "./hazardsApi";

/** "Where are the nearest potholes?" — the hazard map read aloud, for someone who can't see it.
 *  Asked on the start screen (before leaving the house) or by voice during a walk. Nearest three
 *  within 1 km: roughly how far, which side (only once we know which way they're walking), and the
 *  street address when the city has one. */

export const ASK_RADIUS_M = 1000;
const MAX_ITEMS = 3;

/** Spoken distance: "about 60 metres" under 100 m, then to the nearest 50 ("about 350 metres"). */
export function roughMetres(d: number): number {
  return d < 100 ? Math.max(10, Math.round(d / 10) * 10) : Math.round(d / 50) * 50;
}

/** "109 Osgoode St" → "109 Osgoode Street", so the voice doesn't say "Saint". */
export function spokenAddress(a: string): string {
  const words: Record<string, string> = {
    St: "Street", Ave: "Avenue", Av: "Avenue", Dr: "Drive", Rd: "Road", Blvd: "Boulevard", Cres: "Crescent",
    Pl: "Place", Ct: "Court", Pkwy: "Parkway", Ln: "Lane", Terr: "Terrace", E: "East", W: "West", N: "North", S: "South",
  };
  return a.replace(/\b([A-Z][a-z]{0,4})\.?(?=\s|,|$)/g, (m, w: string) => words[w] ?? m);
}

const SIDES: Record<Lang, Record<Side, string>> = {
  en: { ahead: "ahead", left: "on your left", right: "on your right", behind: "behind you" },
  fr: { ahead: "devant", left: "à gauche", right: "à droite", behind: "derrière vous" },
};

export function describeNearby(list: NearHazard[], here: LatLon, direction: number | null, lang: Lang, potholes: boolean): string {
  const fr = lang === "fr";
  const items = list
    .filter((h) => (potholes ? h.type === "pothole" : h.walkway !== false))
    .map((h) => ({ h, d: metresBetween(here, h) }))
    .filter(({ d }) => d <= ASK_RADIUS_M)
    .sort((a, b) => a.d - b.d);
  if (!items.length) {
    if (potholes) return fr ? "Aucun nid-de-poule signalé à moins d'un kilomètre." : "No potholes reported within 1 kilometre.";
    return fr ? "Rien de signalé à moins d'un kilomètre." : "Nothing reported within 1 kilometre.";
  }
  const n = items.length;
  const head = potholes
    ? fr ? `${n} ${n === 1 ? "nid-de-poule signalé" : "nids-de-poule signalés"} à moins d'un kilomètre.`
      : `${n} ${n === 1 ? "pothole" : "potholes"} reported within 1 kilometre.`
    : fr ? `${n} ${n === 1 ? "problème signalé" : "problèmes signalés"} à moins d'un kilomètre.`
      : `${n} reported ${n === 1 ? "problem" : "problems"} within 1 kilometre.`;
  const lead = fr ? ["Le plus proche", "Ensuite", "Puis"] : ["Nearest", "Next", "Then"];
  const parts = items.slice(0, MAX_ITEMS).map(({ h, d }, i) => {
    const side = direction == null ? null : sideOf(direction, bearing(here, h));
    const how = fr ? `à environ ${roughMetres(d)} mètres${side ? ` ${SIDES.fr[side]}` : ""}` : `about ${roughMetres(d)} metres${side ? ` ${SIDES.en[side]}` : ""}`;
    const road = h.walkway === false ? (fr ? ", dans la rue" : ", in the road") : "";
    const at = h.address ? (fr ? `, au ${spokenAddress(h.address)}` : `, at ${spokenAddress(h.address)}`) : "";
    const what = potholes ? "" : `${fr ? h.label_fr : h.label_en}, `;
    return `${lead[i]}: ${what}${how}${road}${at}.`;
  });
  return [head, ...parts].join(" ");
}

/** Where the phone is right now (one GPS reading, high accuracy). */
export function currentPlace(timeoutMs = 15_000): Promise<LatLon & { accuracy: number }> {
  return new Promise((ok, fail) => {
    if (!navigator.geolocation) return fail(new Error("no_location"));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => fail(new Error("no_location")),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: timeoutMs },
    );
  });
}

export const noLocationText = (lang: Lang) =>
  lang === "fr"
    ? "Je ne trouve pas votre position. Vérifiez que la localisation est autorisée."
    : "I can't find your location. Check that location is allowed.";
export const noMapText = (lang: Lang) =>
  lang === "fr" ? "La carte des dangers ne répond pas pour l'instant." : "The hazard map isn't answering right now.";

/** The whole answer: position (given during a walk, or looked up), the reports around it, the words. */
export async function askNearby(lang: Lang, potholes: boolean, here?: LatLon | null, direction: number | null = null): Promise<string> {
  let place: LatLon;
  try { place = here ?? await currentPlace(); } catch { return noLocationText(lang); }
  try {
    const list = await fetchNear(place.lat, place.lon, "", ASK_RADIUS_M, undefined, !potholes);
    return describeNearby(list, place, direction, lang, potholes);
  } catch {
    return noMapText(lang);
  }
}

/** Did they ask about potholes specifically (then road potholes count too)? */
export const asksPotholes = (heard: string) => /pothole|nid[s]?[- ]de[- ]poule/i.test(heard);
