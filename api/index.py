"""Vercel entry: the hazard map API as a Python function at /api/*.

Only the hazard routes run here (no Gemini/ElevenLabs keys on Vercel yet). DATABASE_URL comes from
the Vercel project's Environment Variables, never from a committed file.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from fastapi import FastAPI  # noqa: E402

from hazards import router as hazards_router  # noqa: E402

app = FastAPI(title="SeeWalk hazard map (Vercel)")
app.include_router(hazards_router, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True, "vercel": True}
