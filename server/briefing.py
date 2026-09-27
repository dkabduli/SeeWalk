"""Area briefing: what a blind walker should know within ~300 m, said in one or two sentences.

Built only from real reports (open Ottawa 311 requests and other walkers' sightings, via db.near).
Gemini rewords the list into natural speech with street names; it never adds anything. If Gemini is
slow, fails, promises safety, or answers in the wrong language, a plain summary is said instead.
"""
import asyncio
import logging
from collections import Counter

from google import genai

import config
import db

log = logging.getLogger("seewalk")
_client: genai.Client | None = None  # made on first use: the map works on a server without a Gemini key

RADIUS_M = 300
MAX_ITEMS = 25  # nearest first; plenty for two sentences


def fallback(items: list[dict], lang: str) -> str:
    """Plain summary: counts by kind, most common first. Never says clear or safe."""
    if not items:
        return ("Aucun signalement dans un rayon de 300 mètres." if lang == "fr"
                else "No reported problems within 300 metres.")
    key = "label_fr" if lang == "fr" else "label_en"
    counts = Counter((not i.get("walkway", True), i[key]) for i in items)
    top = sorted(counts.items(), key=lambda kv: (kv[0][0], -kv[1]))[:3]  # sidewalk kinds before road kinds
    parts = ", ".join(f"{label} ({n})" for (_road, label), n in top)
    many = len(items) > 1
    if lang == "fr":
        return f"{len(items)} problème{'s' if many else ''} signalé{'s' if many else ''} à moins de 300 mètres : {parts}."
    return f"{len(items)} reported problem{'s' if many else ''} within 300 metres: {parts}."


def _prompt(items: list[dict], lang: str) -> str:
    key = "label_fr" if lang == "fr" else "label_en"
    lines = "\n".join(
        f"- {i[key]}, {round(i['metres'])} m away" + (f", at {i['address']}" if i.get("address") else "")
        + (" (city report)" if i["source"] != "walkers" else " (seen by other walkers)")
        + ("" if i.get("walkway", True) else " [in the road]")
        for i in items
    )
    language = "French" if lang == "fr" else "English"
    return (
        "You brief a blind pedestrian who is about to walk. Using ONLY the reports below, say in "
        f"{language}, in one or two short sentences (at most 30 words), what they should watch for "
        "nearby: sidewalk, curb and crossing problems first, things [in the road] last or not at all; "
        "group similar ones, name streets. Never add hazards, never guess, "
        "and never say the area is clear or safe. Reply with the sentences only.\n\n" + lines
    )


async def brief(lat: float, lon: float, lang: str = "en") -> dict:
    # Underfoot first (sidewalk, curb, crossing), then problems out in the road; nearest first in each
    items = sorted(db.near(lat=lat, lon=lon, radius=RADIUS_M), key=lambda i: not i.get("walkway", True))[:MAX_ITEMS]
    plain = fallback(items, lang)
    if not items or not config.GEMINI_API_KEY:
        return {"text": plain, "count": len(items), "by": "plain"}
    global _client
    try:
        _client = _client or genai.Client(api_key=config.GEMINI_API_KEY)
        interaction = await asyncio.wait_for(
            _client.aio.interactions.create(
                model=config.GEMINI_MODEL,
                input=[{"type": "text", "text": _prompt(items, lang)}],
                generation_config={"thinking_level": config.GEMINI_THINKING_LEVEL},
            ),
            timeout=4,
        )
        text = interaction.output_text.strip().strip('"«» ')
    except Exception as e:
        log.warning("briefing: Gemini failed: %s", e)
        return {"text": plain, "count": len(items), "by": "plain"}
    from lang_guard import looks_english, promises_safety  # needs a Gemini key to import, like this branch

    wrong_language = looks_english(text) if lang == "fr" else False
    if not text or len(text) > 300 or promises_safety(text) or wrong_language:
        log.info("briefing: rejected %r", text)
        return {"text": plain, "count": len(items), "by": "plain"}
    return {"text": text, "count": len(items), "by": "gemini"}
