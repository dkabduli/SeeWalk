"""End-to-end check of the hazard map against the real Tiger Data database, over HTTP.

Saves a test pin, checks the dedupe and confidence rules, reads it back from the map and hotspot
routes, then deletes its own rows (straight from DATABASE_URL, so run it where server/.env is).

    cd server && .venv/Scripts/python scripts/smoke_hazards.py                                   # local server on :8000
    cd server && .venv/Scripts/python scripts/smoke_hazards.py --base https://visioncompanion.vercel.app/api
"""
import argparse
import sys
import uuid
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # ✅/❌ on a Windows console too
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

import config  # noqa: E402
import db  # noqa: E402

OK, FAIL = "✅", "❌"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:8000", help="server root, e.g. https://visioncompanion.vercel.app/api")
    base = parser.parse_args().base.rstrip("/")
    session = f"smoke-{uuid.uuid4().hex[:12]}"
    # Middle of Lake Ontario: a smoke pin can never be mistaken for a real sidewalk report
    pin = {"session_id": session, "lat": 43.6512, "lon": -77.8923, "type": "pothole", "confidence": 0.9, "source": "test"}
    failed = False

    def check(name: str, passed: bool, detail: object = "") -> None:
        nonlocal failed
        failed |= not passed
        print(f"{OK if passed else FAIL} {name:<28} {detail}")

    try:
        with httpx.Client(base_url=base, timeout=20) as http:
            r = http.post("/hazards", json=pin)
            check("save a confident pothole", r.status_code == 200 and r.json().get("saved") is True, f"{r.status_code} {r.text[:120]}")
            if r.status_code == 503:
                print("   The server has no DATABASE_URL (on Vercel: Settings → Environment Variables, then redeploy).")
                return 1
            r = http.post("/hazards", json=pin)
            check("same spot again = duplicate", r.json().get("reason") == "duplicate", r.text[:120])
            r = http.post("/hazards", json={**pin, "lat": pin["lat"] + 0.01, "confidence": 0.5})
            check("unsure one is not saved", r.json().get("reason") == "low_confidence", r.text[:120])
            r = http.post("/hazards", json={**pin, "type": "car"})
            check("a car is not map material", r.status_code == 422, r.status_code)
            hazards = http.get("/hazards", params={"days": 1}).json()["hazards"]
            mine = [h for h in hazards if abs(h["lat"] - pin["lat"]) < 1e-6 and abs(h["lon"] - pin["lon"]) < 1e-6]
            check("pin is on the map (/hazards)", len(mine) == 1, f"{len(hazards)} pins in the last day")
            spots = http.get("/hazards/hotspots", params={"days": 1, "limit": 100}).json()["hotspots"]
            near = [s for s in spots if abs(s["lat"] - pin["lat"]) < 0.001 and abs(s["lon"] - pin["lon"]) < 0.001]
            check("pin is a hotspot", len(near) == 1, f"{len(spots)} hotspots")
    except httpx.HTTPError as e:
        check("reach the server", False, f"{type(e).__name__}: {e}")
    finally:
        if config.DATABASE_URL:
            with db.connect() as conn:
                n = conn.execute("DELETE FROM hazard_reports WHERE session_id = %s", (session,)).rowcount
            print(f"   cleaned up {n} test row(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
