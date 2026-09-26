"""SeeWalk backend.

    cd server && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000

POST /analyze  snapshot (+ previous) → Gemini → hazards as JSON (SceneResult)
POST /tts      phrase → ElevenLabs (River) → mp3
POST /listen   speech clip → Gemini → was it "SeeWalk, what's ahead?"   (listen.py)
POST /detect   Aroha's first endpoint: image → comma-separated object list (debugging)
GET  /health
"""
import base64
import logging
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from google import genai
from google.genai import types

import config
from gemini import analyze_frame
from listen import router as listen_router
from schemas import AnalyzeRequest, SceneResult, TTSRequest
from tts import synthesize

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("seewalk")

app = FastAPI(title="SeeWalk")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(listen_router)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze", response_model=SceneResult)
async def analyze(req: AnalyzeRequest):
    start = time.perf_counter()
    try:
        result = await analyze_frame(req.image, req.lang, req.prev_image)
    except Exception as e:
        log.warning("analyze failed: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=503, detail="vision unavailable")
    log.info(
        "analyze %.0f ms, %d hazards%s %s",
        (time.perf_counter() - start) * 1000,
        len(result.hazards),
        " (unclear)" if result.unclear else "",
        [f"{h.phrase} {h.confidence:.2f}" for h in result.hazards],
    )
    return result


@app.post("/tts")
async def tts(req: TTSRequest):
    start = time.perf_counter()
    try:
        audio = await synthesize(req.text, req.lang)
    except Exception as e:
        log.warning("tts failed: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=503, detail="voice unavailable")
    log.info("tts %.0f ms %r", (time.perf_counter() - start) * 1000, req.text)
    return Response(content=audio, media_type="audio/mpeg")


# ---- Aroha's /detect (kept for debugging; the app uses /analyze) ----
_detect_client = genai.Client(api_key=config.GEMINI_API_KEY)


@app.post("/detect")
async def detect(data: dict):
    image_data = data["image"].split(",")[1]
    image_bytes = base64.b64decode(image_data)

    response = await _detect_client.aio.models.generate_content(
        model=config.GEMINI_MODEL,
        contents=[
            {
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": image_bytes,
                }
            },
            "Identify all visible objects. Output ONLY a comma-separated list of object names. No sentences, no introduction, no explanation, no punctuation other than commas.",
        ],
        config=types.GenerateContentConfig(max_output_tokens=200),
    )
    return {"result": response.text}
