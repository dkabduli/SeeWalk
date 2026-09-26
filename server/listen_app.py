"""Stand-in server with /listen, /health and a FAKE /analyze, so the camera + voice pieces can be
tested on the iPhone (over the real network) before Aroha's main.py exists.
Delete once main.py exists and includes listen.router.

    cd server && .venv/bin/uvicorn listen_app:app --host 0.0.0.0 --port 8000
"""
import itertools
import logging

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


# FAKE /analyze: same rotating results as the web mock, but served over the network, so
# airplane mode really cuts the snapshot loop off (tests no_connection / connection_back).
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
    return next(_FAKE)
