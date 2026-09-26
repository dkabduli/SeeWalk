"""POST /listen: did the walker just say "SeeWalk, what's ahead?"

The phone records short speech clips itself (Safari's built-in speech recognition is blocked on
some iPhones: `service-not-allowed`) and sends them here. Gemini transcribes the clip and decides
whether it was the command. Measured: ~1.4-2.2 s per clip, EN and FR.

Aroha: add to main.py
    from listen import router as listen_router
    app.include_router(listen_router)
"""
import asyncio
import base64
import logging
import os
import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from google import genai
from pydantic import BaseModel, Field

import config

log = logging.getLogger("seewalk")
router = APIRouter()
_client = genai.Client(api_key=config.GEMINI_API_KEY)

PROMPT = (
    "Transcribe this short clip from a phone microphone. Set command=true ONLY if the speaker says the "
    "wake word 'SeeWalk' (it may sound like 'see walk' or 'sea walk') AND asks what is ahead or in front, "
    "in English or French (e.g. 'SeeWalk, what's ahead?', 'SeeWalk, qu'y a-t-il devant ?'). "
    "Anything else, including background talk or a voice saying hazard warnings like 'Pothole ahead', "
    "is command=false. If nothing intelligible is said, heard is an empty string."
)


class ListenRequest(BaseModel):
    audio: str = Field(description="base64 WAV, 16 kHz mono")
    lang: Literal["en", "fr"] = "en"


class ListenResult(BaseModel):
    heard: str = Field(description="What the person said, transcribed")
    command: bool = Field(description="True only if they addressed SeeWalk and asked what is ahead / in front")


async def detect_command(audio_b64: str) -> ListenResult:
    interaction = await asyncio.wait_for(
        _client.aio.interactions.create(
            model=config.GEMINI_MODEL,
            input=[
                {"type": "text", "text": PROMPT},
                {"type": "audio", "data": audio_b64, "mime_type": "audio/wav"},
            ],
            generation_config={"thinking_level": config.GEMINI_THINKING_LEVEL},
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": ListenResult.model_json_schema(),
            },
        ),
        timeout=5,
    )
    return ListenResult.model_validate_json(interaction.output_text)


@router.post("/listen", response_model=ListenResult)
async def listen(req: ListenRequest):
    start = time.perf_counter()
    try:
        if os.getenv("SEEWALK_SAVE_AUDIO"):  # debugging: keep the last clip to listen to
            with open(os.environ["SEEWALK_SAVE_AUDIO"], "wb") as f:
                f.write(base64.b64decode(req.audio))
        result = await detect_command(req.audio)
    except Exception as e:
        log.warning("listen failed: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=503, detail="listening unavailable")
    log.info("listen %.0f ms command=%s heard=%r", (time.perf_counter() - start) * 1000, result.command, result.heard)
    return result
