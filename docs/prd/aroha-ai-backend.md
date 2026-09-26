# PRD: AI + Backend (Aroha)

> **Status (Sept 26, 2:45 PM): built by Abdul from this PRD** so the team could film. `server/main.py` has `/analyze`, `/tts`, `/listen`, `/health`, plus Aroha's `/detect`. Eval on the 15 samples after one prompt-tuning round: off-path hydrants/poles ignored, parked bikes = obstacles, stop signs/crosswalks = info, median 1.66 s. **Aroha: next is more prompt tuning with new daytime samples** (`scripts/eval_samples.py`).

> Read [the shared contract](README.md) first. Your endpoints must match it exactly.

## 1. Summary

You own the **server**: the part that holds the API keys and talks to the two AI services.

- **`POST /analyze`**: snapshot in → **Gemini** → hazards out as JSON
- **`POST /tts`**: short phrase in → **ElevenLabs** → River's voice out as mp3
- **Prompt tuning**: make Gemini report the right things, in ≤ 4 words, and never make things up

Everything the walker hears passes through your two endpoints, so **reliability matters more than features**.

## 2. What already exists

| File | What it does |
|---|---|
| `server/config.py` | Loads every key and setting from `server/.env` (`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `ELEVENLABS_*`, `ALLOWED_ORIGINS`) |
| `server/requirements.txt` | fastapi, uvicorn, google-genai, pydantic, httpx, python-dotenv |
| `server/scripts/check_connections.py` | Proves both keys work, and shows the basic SDK/HTTP calls |
| `server/scripts/generate_clips.py` | How we made the bundled clips (a good ElevenLabs example) |

**Numbers we already measured** (laptop, home Wi-Fi):
- Gemini 3.5 Flash-Lite, minimal thinking: **1.2–1.7 s** per snapshot; sending 2 frames costs no extra time
- ElevenLabs Flash v2.5: **~0.2 s**; cached repeats ~1 ms
- Occasionally a Gemini call takes > 4 s. That's why there's a timeout.

## 3. Setup (15 min)

```bash
git clone https://github.com/dkabduli/SeeWalk.git
cd SeeWalk && git checkout Arohas-Work && git pull origin main
cd server
python3 --version                       # must be 3.10+ (brew install python@3.12 if not)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env                    # add your OWN Gemini key + the team ElevenLabs key (from Abdul)
.venv/bin/python scripts/check_connections.py   # expect ✅ Gemini, ✅ ElevenLabs
```

Create your own free Gemini key at <https://aistudio.google.com/api-keys> so you don't share Abdul's rate limit.

## 4. Step-by-step

### Step 1: `server/schemas.py` (the contract in Python)

These models are used three times: to validate requests, to give Gemini its JSON schema, and to validate Gemini's answer.

```python
from typing import Literal, Optional

from pydantic import BaseModel, Field

HazardType = Literal[
    "person", "bike", "car", "crosswalk", "stop_sign", "pothole", "uneven_surface",
    "head_height_obstacle", "obstacle_in_path", "construction", "curb_or_dropoff",
    "stairs_down", "other",
]


class Hazard(BaseModel):
    type: HazardType
    direction: Literal["left", "ahead", "right"]
    distance: Literal["close", "near", "far"]
    urgency: int = Field(ge=1, le=3, description="1 = immediate danger within ~2 m, 2 = obstacle or surface problem in the path, 3 = information")
    confidence: float = Field(ge=0, le=1)
    approaching: bool = Field(description="True if it is moving toward the walker between the two frames")
    phrase: str = Field(description="At most 4 words, hazard then direction, in the requested language")


class SceneResult(BaseModel):
    hazards: list[Hazard]
    unclear: bool = Field(description="True if the image is too blurry or dark to judge")
    summary: str = Field(
        description="What is in front of the camera, hazard or not, in at most 6 words in the requested "
        "language (e.g. 'Laptop and a bottle on a table'). Only spoken when the walker asks 'What's ahead?'. "
        "Empty if unclear."
    )


class AnalyzeRequest(BaseModel):
    image: str
    prev_image: Optional[str] = None
    lang: Literal["en", "fr"] = "en"


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=80)
    lang: Literal["en", "fr"] = "en"
```

The `description=` text is sent to Gemini as part of the schema, so treat it as part of the prompt.

### Step 2: `server/gemini.py` (the vision call)

We use Gemini's **multimodal vision**: text instructions + one or two images in a single request. With the previous frame included, Gemini can judge `approaching` (someone getting closer) at no extra latency.

```python
import asyncio

from google import genai

import config
from schemas import SceneResult

_client = genai.Client(api_key=config.GEMINI_API_KEY)
LANGUAGE = {"en": "English", "fr": "French"}

PROMPT = """You assist a blind pedestrian walking on a quiet street. The camera is chest-height, facing forward.
Report ONLY things that matter for walking safely in the next ~10 metres, IN THE WALKING PATH (the sidewalk or
floor straight ahead, roughly the middle of the image). Leave out anything beside the path (hydrants or poles on
the grass, signs at the edge, parked cars at the curb), buildings, sky.
Types:
- person / bike / car: ONLY if moving toward or across the walker's path. A parked bike, bike rack or parked car
  that blocks the path is obstacle_in_path, never bike/car.
- obstacle_in_path: anything standing in the path (bins, posts, chairs, closed doors including glass doors).
- head_height_obstacle: branches, signs, mirrors at head height. curb_or_dropoff, stairs_down: edges and steps down.
- crosswalk, stop_sign: only if clearly visible ahead. pothole, uneven_surface, construction.
Urgency: 1 = immediate danger within ~2 m (a drop-off or stairs down, a head-height obstacle, something moving at
the walker). 2 = obstacle or surface problem in the path. 3 = information (crosswalk, stop sign).
Never guess: if it isn't clearly visible, leave it out. At most 3 hazards, most important first.
If the image is too blurry or dark, set unclear=true. Never say anything is safe to cross.
If a previous frame is given, use it only to judge whether things are approaching.
Also fill summary: the main things in front of the camera in at most 6 words, hazard or not (e.g. "Laptop and
lotion on a table", "Empty hallway", "Street with parked cars"). Plain nouns, no guessing; empty if unclear.
Write each phrase in {language}, at most 4 words, naming the actual thing, then direction
(e.g. "Bins ahead", "Glass door ahead", "Parked bike ahead", "Person on your left")."""


async def analyze_frame(image_b64: str, lang: str = "en", prev_image_b64: str | None = None) -> SceneResult:
    parts = [{"type": "text", "text": PROMPT.format(language=LANGUAGE[lang])}]
    if prev_image_b64:
        parts += [
            {"type": "text", "text": "Previous frame (about 1.5 s earlier):"},
            {"type": "image", "data": prev_image_b64, "mime_type": "image/jpeg"},
            {"type": "text", "text": "Current frame:"},
        ]
    parts.append({"type": "image", "data": image_b64, "mime_type": "image/jpeg"})

    interaction = await asyncio.wait_for(
        _client.aio.interactions.create(
            model=config.GEMINI_MODEL,
            input=parts,
            generation_config={"thinking_level": config.GEMINI_THINKING_LEVEL},
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": SceneResult.model_json_schema(),
            },
        ),
        timeout=4,
    )
    return SceneResult.model_validate_json(interaction.output_text)
```

Why these choices:
- **`gemini-3.5-flash-lite` + `thinking_level: "minimal"`**: we measured Gemini 3.8 Flash at 4–38 s. Flash-Lite is ~1.3 s.
- **`response_format` with our schema**: Gemini must return valid JSON in our shape, so the phone never has to parse free text.
- **`timeout=4`**: the phone gives up at 5 s. Failing fast lets the phone move on to a fresher snapshot.

### Step 3: `server/scripts/try_analyze.py` (quick manual test)

```python
"""python scripts/try_analyze.py ../samples/stop.jpg [fr]"""
import asyncio, base64, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gemini import analyze_frame  # noqa: E402

img = base64.b64encode(Path(sys.argv[1]).read_bytes()).decode()
lang = sys.argv[2] if len(sys.argv) > 2 else "en"
start = time.perf_counter()
result = asyncio.run(analyze_frame(img, lang))
print(f"{(time.perf_counter() - start) * 1000:.0f} ms")
print(result.model_dump_json(indent=2))
```

Phone photos are big. Shrink them first, the same way the phone will: `sips -Z 768 photo.jpg --out samples/photo.jpg`.

### Step 4: `server/scripts/eval_samples.py` (the go/no-go test)

Loop over `samples/*.jpg` (the team's chest-height photos). For each, print the filename, time, `unclear`, and every hazard as `type / direction / confidence / "phrase"`. At the end print the **median and worst time**, and save everything to `samples/results.json` so you can compare prompt versions.

Then **read every result against the photo** and keep a tally:

| Photo | Expected | Got | Missed? | Invented? |
|---|---|---|---|---|
| stop.jpg | stop sign ahead | stop_sign ahead 0.93 "Stop sign ahead" | | |

### Step 5: Tune the prompt

Work through these, re-running the eval each time:
1. **Invented hazards** (worst failure): strengthen "Never guess", or raise the confidence it should use for uncertain things.
2. **Missed hazards**: name the missed thing explicitly in the list.
3. **Phrases too long, or in English when `lang=fr`**: add an example in French: `"Voiture à droite"`.
4. **Wrong direction**: add "left = left third of the image, ahead = middle third, right = right third".
5. **Too chatty** (lots of low-value hazards): "Report at most 3 hazards, most important first."

Keep the final prompt in `gemini.py`. Paste before/after results in your PR description; it makes a good Devpost "challenges" story.

### Step 6: `server/tts.py` (ElevenLabs)

```python
import httpx

import config

_cache: dict[tuple[str, str], bytes] = {}
_http = httpx.AsyncClient(timeout=10)


async def synthesize(text: str, lang: str = "en") -> bytes:
    key = (text.strip().lower(), lang)
    if key in _cache:
        return _cache[key]
    r = await _http.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{config.ELEVENLABS_VOICE_ID}",
        params={"output_format": "mp3_44100_64"},
        headers={"xi-api-key": config.ELEVENLABS_API_KEY},
        json={"text": text, "model_id": config.ELEVENLABS_TTS_MODEL, "language_code": lang},
    )
    r.raise_for_status()
    if len(_cache) >= 200:
        _cache.pop(next(iter(_cache)))
    _cache[key] = r.content
    return r.content
```

The cache matters: the same phrases ("Stop sign ahead") repeat constantly, and a cached one comes back in ~1 ms.

### Step 7: `server/main.py` (the API)

```python
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
```

Never log the image itself: it's huge, and privacy matters (frames are processed and discarded).

### Step 7b: Voice-command router

`server/listen.py` (`POST /listen`) is included by `main.py` above (`app.include_router(listen_router)`).

### Step 8: Run and test

```bash
cd server
.venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

In another terminal:
```bash
curl localhost:8000/health
curl -X POST localhost:8000/tts -H 'content-type: application/json' \
  -d '{"text":"Stop sign ahead","lang":"en"}' -o /tmp/out.mp3 && afplay /tmp/out.mp3
python3 -c "import base64,json;print(json.dumps({'image':base64.b64encode(open('../samples/stop.jpg','rb').read()).decode(),'lang':'en'}))" > /tmp/body.json
curl -X POST localhost:8000/analyze -H 'content-type: application/json' -d @/tmp/body.json
```

Also open <http://localhost:8000/docs>: FastAPI's built-in page lets you try each endpoint.

**Testing tip:** in pytest, use `with TestClient(app) as client:`. Without the `with`, each request gets a new event loop, and the shared Gemini client fails with an instant 503. That confused us once already.

### Step 9: Hand off
- Push to `Arohas-Work`, open a PR into `main`, and tell Jibril and Abdul `/analyze` and `/tts` are live.
- During the day, keep uvicorn running on the laptop the tunnel points at (Siddig's tunnel → Vite → `/api` → your server).

## 5. Done when

- [ ] `/health`, `/analyze`, `/tts` all work as in Step 8
- [ ] Eval on the team's photos: **median ≤ 1.5 s**, **zero invented hazards**, stop signs / crosswalks / curbs / obstacles found
- [ ] French: `lang=fr` gives French phrases, and `/tts` speaks them correctly
- [ ] Gemini errors and timeouts return `503` (never a crash, never a 500)
- [ ] PR merged into `main`

## 6. Gotchas

| Problem | Fix |
|---|---|
| `429` / quota errors | Free tier. Ask Abdul to turn on billing on the demo key; slow the phone to 5–6 s per snapshot during dev |
| `ModuleNotFoundError` in scripts | Run from `server/` with `.venv/bin/python`, or add the `sys.path.insert` line like the other scripts |
| Python 3.9 | The SDK that works with 3.9 doesn't have the Interactions API. Use 3.10+ |
| JSON schema rejected by Gemini | Check the error; `Field(ge=, le=)` constraints can be dropped if the API complains |
| Gemini says a crossing is "safe" | The prompt forbids it; if it ever happens, add a server-side filter that drops phrases containing "safe" |

## 7. Stretch (only after "Done when" is all ✅)
- **Bounding boxes**: ask Gemini for `box_2d` per hazard (adds ~0.3 s) and compute `direction` from the box's centre in code, which is more reliable than Gemini's word.
- **"Ask" endpoint**: `POST /ask {image, question, lang}` → a one-sentence answer, for spoken questions like "What does that sign say?"
- Tiger Data: `POST /hazards` to save potholes with GPS for the map.
