"""Ping every external service SeeWalk uses and print a pass/fail line for each.

Run from the repo root:  python server/scripts/check_connections.py
"""
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # ✅/❌ on a Windows console too
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config  # noqa: E402

import httpx  # noqa: E402

OK, FAIL, SKIP = "✅", "❌", "⚪"


def check_gemini() -> tuple[str, str]:
    if not config.GEMINI_API_KEY:
        return SKIP, "GEMINI_API_KEY not set"
    from google import genai

    client = genai.Client(api_key=config.GEMINI_API_KEY)
    start = time.perf_counter()
    interaction = client.interactions.create(
        model=config.GEMINI_MODEL,
        input="Reply with exactly: OK",
    )
    ms = (time.perf_counter() - start) * 1000
    return OK, f"{config.GEMINI_MODEL} replied {interaction.output_text.strip()!r} in {ms:.0f} ms"


def check_elevenlabs() -> tuple[str, str]:
    if not config.ELEVENLABS_API_KEY:
        return SKIP, "ELEVENLABS_API_KEY not set"
    headers = {"xi-api-key": config.ELEVENLABS_API_KEY}
    r = httpx.get("https://api.elevenlabs.io/v1/voices", headers=headers, timeout=10)
    r.raise_for_status()
    voices = r.json().get("voices", [])
    msg = f"{len(voices)} voices available"
    if config.ELEVENLABS_VOICE_ID:
        match = [v["name"] for v in voices if v["voice_id"] == config.ELEVENLABS_VOICE_ID]
        msg += f"; ELEVENLABS_VOICE_ID = {match[0]!r}" if match else "; ELEVENLABS_VOICE_ID not found in your voices"
    else:
        msg += "; ELEVENLABS_VOICE_ID not set yet"
    return OK, msg


def check_database() -> tuple[str, str]:
    if not config.DATABASE_URL:
        return SKIP, "DATABASE_URL not set (only needed for the hazard map)"
    import psycopg

    with psycopg.connect(config.DATABASE_URL, connect_timeout=10) as conn:
        version = conn.execute("select version()").fetchone()[0]
    return OK, version.split(",")[0]


def main() -> int:
    failed = False
    for name, fn in [("Gemini", check_gemini), ("ElevenLabs", check_elevenlabs), ("Tiger Data", check_database)]:
        try:
            status, msg = fn()
        except Exception as e:  # report every failure, keep checking the rest
            status, msg = FAIL, f"{type(e).__name__}: {e}"
        failed |= status == FAIL
        print(f"{status} {name:<11} {msg}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
