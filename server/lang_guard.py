"""French mode must never speak English.

Gemini Flash-Lite answers in the requested language almost always, but in testing ~1 answer in 30
still came back in English in French mode ("Large open sidewalk ahead"), because the prompt's
examples are English. Anything that reads as English in French mode is translated before it
reaches the phone. "Read this" answers are left alone: those are read word for word.
"""
import asyncio
import logging
import re

from google import genai

import config

log = logging.getLogger("seewalk")
_client = genai.Client(api_key=config.GEMINI_API_KEY)

_WORD = re.compile(r"[a-zàâçéèêëîïôûùüÿœ']+", re.I)
_EN = {
    "the", "and", "with", "of", "on", "your", "ahead", "left", "right", "in", "is", "are", "there", "near",
    "behind", "front", "nothing", "detected", "path", "hand", "holding", "see", "can't", "i", "you", "to",
    "at", "from", "large", "small", "open", "a", "an", "into", "its", "it's", "some", "two", "three",
}
_FR = {
    "le", "la", "les", "des", "du", "de", "un", "une", "et", "avec", "sur", "devant", "gauche", "droite",
    "votre", "vous", "dans", "à", "en", "il", "y", "rien", "chemin", "main", "je", "ne", "pas", "au", "aux",
    "est", "sont", "qui", "d'un", "d'une", "l'", "grand", "grande", "grands", "grandes", "deux", "trois",
}


def looks_english(text: str) -> bool:
    words = [w.lower() for w in _WORD.findall(text)]
    en = sum(w in _EN for w in words)
    fr = sum(w in _FR or w.startswith(("l'", "d'", "qu'")) for w in words)
    return (en >= 2 and en > fr) or (en >= 1 and fr == 0 and len(words) <= 4)


async def translate(text: str, lang: str) -> str:
    """Translation to French for an English slip. Empty string if it fails (say nothing, not English)."""
    try:
        interaction = await asyncio.wait_for(
            _client.aio.interactions.create(
                model=config.GEMINI_MODEL,
                input=[{"type": "text", "text": (
                    "Translate into natural French, short, for a blind pedestrian. "
                    f"Reply with the translation only.\n\n{text}"
                )}],
                generation_config={"thinking_level": config.GEMINI_THINKING_LEVEL},
            ),
            timeout=2.5,
        )
        out = interaction.output_text.strip().strip('"«» ')
        log.info("lang_guard: %r → %r", text, out)
        return out if out and not looks_english(out) else ""
    except Exception as e:
        log.warning("lang_guard: translation failed for %r: %s", text, e)
        return ""


# SeeWalk never says a way is clear or safe, in either language ("dégagé" and "libre" mean clear)
_ALL_CLEAR = re.compile(
    r"\b(clear|safe|safely|unobstructed|dégagée?s?|degagee?s?|libres?|sûre?s?|sans (danger|obstacle)|"
    r"en sécurité|sécuritaire)\b",
    re.I,
)


def promises_safety(text: str) -> bool:
    return bool(_ALL_CLEAR.search(text))


async def in_language(text: str, lang: str) -> str:
    """The text, not English when lang is French, and never promising a clear or safe way."""
    if lang == "fr" and text and looks_english(text):
        text = await translate(text, lang)
    return "" if promises_safety(text) else text
