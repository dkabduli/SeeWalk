"""Vercel entry: the whole VisionCompanion server as one Python function.

    /api/*      → the FastAPI server in server/ (analyze, listen, tts, health, hazard map)
    /__lablog   → the phone's debug log, printed to the Vercel logs (the laptop wrote it to a file)

Keys come from the Vercel project's Environment Variables, never from a committed file.
The real per-phone limit is a Vercel Firewall rule ("API per-phone limit": 400 requests/min per IP on
/api), which counts across all server copies. The in-code limiter (server/ratelimit.py) only counts
within one copy, so on Vercel it's a backstop; on a single server (the laptop) it's the limit.
"""
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402

from main import app as server  # noqa: E402
from ratelimit import RateLimiter  # noqa: E402

log = logging.getLogger("seewalk")

app = FastAPI(title="VisionCompanion (Vercel)")
limiter = RateLimiter()


def client_of(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or request.headers.get("x-real-ip", "") or "unknown"


@app.middleware("http")
async def per_phone_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and not limiter.allow(client_of(request), request.url.path):
        return JSONResponse({"detail": "too many requests"}, status_code=429)
    return await call_next(request)


@app.post("/__lablog")
async def lab_log(request: Request):
    body = (await request.body()).decode("utf-8", "replace")[:2000]
    try:
        line = json.loads(body)
        log.info("phone %s %s: %s", line.get("at"), line.get("kind"), line.get("text"))
    except ValueError:
        log.info("phone %s", body)
    return Response(status_code=204)


app.mount("/api", server)
