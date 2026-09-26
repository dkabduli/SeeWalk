"""Stand-in server with only /listen and /health, so the voice command can be tested on the
iPhone before Aroha's main.py exists. Delete once main.py includes listen.router.

    cd server && .venv/bin/uvicorn listen_app:app --host 0.0.0.0 --port 8000
"""
import logging

from fastapi import FastAPI

from listen import router

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="SeeWalk (listen only)")
app.include_router(router)


@app.get("/health")
def health():
    return {"ok": True, "only": "listen"}
