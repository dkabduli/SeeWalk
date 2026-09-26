"""POST /listen: voice commands. "SeeWalk, <question>"

The phone records short speech clips itself (Safari's built-in speech recognition is blocked on
some iPhones: `service-not-allowed`) and sends each one here together with the current camera
frame. In ONE Gemini call we transcribe the clip and work out which command (if any) was asked.
Holding and read are answered here. What's ahead and what's in the way are answered by the app
from the walking-scene look, so this call leaves those answers empty.

Commands (all need the wake word "SeeWalk"):
    whats_ahead  "what's ahead / in front of me?"   → the app answers from its scene look (answer stays "")
    holding      "what am I holding / what's in my hand?"
    path         "what's blocking my path / is my path clear?"   → the app answers from its scene look (answer stays "")
    read         "read this / what does the sign say?"
    cross        "is it safe to cross?"   → the app plays a fixed refusal; never a yes
    where        "where was the elevator?" → the app answers from the last 30 seconds, no new photo
    none         anything else (background talk, SeeWalk's own voice, no wake word)
"""
import asyncio
import base64
import logging
import os
import re
import time
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from google import genai
from pydantic import BaseModel, Field

import config
from lang_guard import in_language

log = logging.getLogger("seewalk")
router = APIRouter()
_client = genai.Client(api_key=config.GEMINI_API_KEY)
LANGUAGE = {"en": "English", "fr": "French"}

Intent = Literal["none", "whats_ahead", "holding", "path", "read", "cross", "where"]

PROMPT = """The audio is a short clip from the phone microphone of a blind pedestrian. {image_note}
1. heard: transcribe what was said ("" if nothing intelligible).
2. intent: ONLY if the speaker says the wake word "Vision Companion" (it may sound like "see walk",
   "sea walk", "C walk") AND asks one of these, in English or French:
   - what is ahead / in front of me / what is this / what is that    → whats_ahead
   - what am I holding / what is in my hand                          → holding
   - what is blocking my path / is my path clear / what's in my way  → path
   - read this / what does it say / read the sign                    → read
   - is it safe to cross / can I cross                               → cross
   - where was / where were / où était (the elevator, the stairs)   → where
   Anything else (no wake word, background talk, or a voice announcing hazards like "Pothole ahead")
   is none.
3. answer, in {language}, from the image only, for these intents:
   - whats_ahead, path: "" (the app answers from its own look at the walking corridor, so a second
     description here would disagree with a street alert).
   - holding: name the object in the person's hand in at most 8 words ("A blue water bottle").
     If no hand or held object is visible: "I can't see anything in your hand".
   - read: the visible text, word for word, at most 25 words. If none is readable: "I can't see any
     text to read".
   - cross, where, none: "" (the app handles these).
Never guess: describe only what is clearly visible."""


# Gemini's intent is double-checked against its own transcription, because in testing it (1) let
# "What am I holding?" through without the wake word, and (2) turned SeeWalk's own alert "Bins
# ahead. Crosswalk ahead." into "SeeWalk, cross ahead" → cross. The transcript must contain the
# wake word AND a keyword for the command, or it's treated as none.
WAKE = re.compile(
    r"\b(vision[\s-]?companion|see[\s-]?walk|sea[\s-]?walk|c[\s-]?walk|si[\s-]?walk|cee[\s-]?walk)\b",
    re.I,
)
KEYWORDS: dict[str, re.Pattern] = {
    "whats_ahead": re.compile(
        r"ahead|front|devant|around|autour|(?:what(?:'s| is|s)|whats) (?:this|that)|c'est quoi|qu'est[- ]ce que c'est",
        re.I,
    ),
    "holding": re.compile(r"hold|hand|tiens|tenir|main", re.I),
    "path": re.compile(r"path|way|block|obstacle|chemin|bloqu|passage", re.I),
    "read": re.compile(r"\bread|\bsay|\bsays|\bsign|\blis|\blire|\blisez|\bécrit|panneau", re.I),
    "cross": re.compile(r"safe|can i cross|should i cross|ok to cross|traverser|sécuritaire|en sécurité", re.I),
    "where": re.compile(r"where was|where were|where'?s|où était|ou etait|où est|ou est", re.I),
}


# what's ahead / what's in my way are spoken from the scene look (gemini.py), not from this call.
APP_ANSWERED = {"holding", "read"}


def answer_for(intent: str, text: str) -> str:
    """Keep Gemini's sentence only for holding and read. The path questions are answered elsewhere."""
    return text.strip() if intent in APP_ANSWERED else ""


def verified_intent(intent: str, heard: str) -> str:
    """Keep Gemini's intent only if the transcript backs it up."""
    if not WAKE.search(heard):
        return "none"
    # "Where was the elevator?" is memory, even if the model heard it as what's ahead.
    if KEYWORDS["where"].search(heard):
        return "where"
    if intent == "none":
        return "none"
    pattern = KEYWORDS.get(intent)
    return intent if pattern and pattern.search(heard) else "none"


class ListenRequest(BaseModel):
    audio: str = Field(description="base64 WAV, 16 kHz mono")
    lang: Literal["en", "fr"] = "en"
    image: Optional[str] = Field(default=None, description="base64 JPEG: the camera frame when the speech ended")


class ListenResult(BaseModel):
    heard: str = Field(description="What the person said, transcribed")
    intent: Intent = Field(description="Which SeeWalk command was asked, or none")
    answer: str = Field(description="Spoken answer for holding / read, otherwise empty")
    command: bool = Field(default=False, description="True if any command was asked (intent != none)")


class _GeminiListen(BaseModel):  # what Gemini fills in (command is derived, not asked for)
    heard: str
    intent: Intent
    answer: str


async def detect_command(audio_b64: str, lang: str = "en", image_b64: str | None = None) -> ListenResult:
    image_note = (
        "The image is what their chest camera sees right now." if image_b64
        else "There is no image, so answer is always \"\"."
    )
    parts = [
        {"type": "text", "text": PROMPT.format(image_note=image_note, language=LANGUAGE.get(lang, "English"))},
        {"type": "audio", "data": audio_b64, "mime_type": "audio/wav"},
    ]
    if image_b64:
        parts.append({"type": "image", "data": image_b64, "mime_type": "image/jpeg"})
    interaction = await asyncio.wait_for(
        _client.aio.interactions.create(
            model=config.GEMINI_MODEL,
            input=parts,
            generation_config={"thinking_level": config.GEMINI_THINKING_LEVEL},
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": _GeminiListen.model_json_schema(),
            },
        ),
        timeout=6,
    )
    g = _GeminiListen.model_validate_json(interaction.output_text)
    intent = verified_intent(g.intent, g.heard)
    if intent != g.intent:
        log.info("listen: Gemini said %s for %r, not confirmed by the transcript → none", g.intent, g.heard)
    answer = answer_for(intent, g.answer)
    if intent != "read":  # "read this" is word for word, in whatever language the sign is in
        answer = await in_language(answer, lang)
    return ListenResult(
        heard=g.heard, intent=intent, answer=answer, command=intent != "none"
    )


@router.post("/listen", response_model=ListenResult)
async def listen(req: ListenRequest):
    start = time.perf_counter()
    try:
        if os.getenv("SEEWALK_SAVE_AUDIO"):  # debugging: keep the last clip to listen to
            with open(os.environ["SEEWALK_SAVE_AUDIO"], "wb") as f:
                f.write(base64.b64decode(req.audio))
        result = await detect_command(req.audio, req.lang, req.image)
    except Exception as e:
        log.warning("listen failed: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=503, detail="listening unavailable")
    log.info(
        "listen %.0f ms intent=%s heard=%r answer=%r%s",
        (time.perf_counter() - start) * 1000, result.intent, result.heard, result.answer,
        "" if req.image else " (no image)",
    )
    return result
