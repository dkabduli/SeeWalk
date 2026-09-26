"""Stand-in server with /listen, /health and a placeholder /analyze (answers "nothing seen"), so the
camera + voice pieces can be tested on the iPhone before Aroha's main.py exists.
Delete once main.py exists and includes listen.router.

    cd server && .venv/bin/uvicorn listen_app:app --host 0.0.0.0 --port 8000
"""
import itertools
import logging
import os

from fastapi import FastAPI

from hazards import router as hazards_router
from listen import router

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="SeeWalk (stand-in: listen + fake analyze)")
app.include_router(router)
app.include_router(hazards_router)  # hazard map (needs DATABASE_URL)


@app.get("/health")
def health():
    return {"ok": True, "stand_in": True}


# /analyze stand-in: answers "nothing seen" so SeeWalk never speaks made-up hazards (the
# rotating fakes were being spoken during real walks). For plumbing tests only (e.g. airplane
# mode), start with SEEWALK_FAKE_ANALYZE=1 to get rotating fake results again.
_NOTHING = {"hazards": [], "unclear": False}
_FAKE = itertools.cycle([
    {"hazards": [], "unclear": False},
    {"hazards": [{"type": "stop_sign", "direction": "ahead", "distance": "near", "urgency": 3, "confidence": 0.93,
                  "approaching": False, "phrase": "Stop sign ahead (server fake)"}], "unclear": False},
    {"hazards": [{"type": "car", "direction": "right", "distance": "near", "urgency": 1, "confidence": 0.91,
                  "approaching": True, "phrase": "Car on your right (server fake)"}], "unclear": False},
    {"hazards": [], "unclear": True},
])


@app.post("/analyze")
def fake_analyze(body: dict):
    return next(_FAKE) if os.getenv("SEEWALK_FAKE_ANALYZE") else _NOTHING
