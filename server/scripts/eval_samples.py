"""Run every photo in samples/ through Gemini (the same call as POST /analyze) and print what
SeeWalk would say, with timing. Compare against the "should / must not report" table in
samples/README.md, tune the prompt in gemini.py, run again.

    cd server && .venv/bin/python scripts/eval_samples.py            # English
    cd server && .venv/bin/python scripts/eval_samples.py fr         # French
Results are also saved to samples/results.json.
"""
import asyncio
import base64
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gemini import analyze_frame  # noqa: E402

SAMPLES = Path(__file__).resolve().parents[2] / "samples"
MIN_CONFIDENCE = 0.6  # the phone ignores anything below this (pickAlert)


async def main(lang: str) -> None:
    rows, times = [], []
    for photo in sorted(SAMPLES.glob("*.jpg")):
        image = base64.b64encode(photo.read_bytes()).decode()
        start = time.perf_counter()
        try:
            result = await analyze_frame(image, lang)
        except Exception as e:  # keep going; a failure is a result too
            print(f"{photo.stem:<42} ERROR {type(e).__name__}: {e}")
            rows.append({"photo": photo.name, "error": str(e)})
            continue
        ms = (time.perf_counter() - start) * 1000
        times.append(ms)
        spoken = [h for h in result.hazards if h.confidence >= MIN_CONFIDENCE]
        said = " | ".join(f"{h.phrase} ({h.type} {h.confidence:.2f} u{h.urgency})" for h in spoken) or "—"
        quiet = [f"{h.type} {h.confidence:.2f}" for h in result.hazards if h.confidence < MIN_CONFIDENCE]
        print(f"{photo.stem:<42} {ms:5.0f} ms  {'UNCLEAR ' if result.unclear else ''}{said}"
              + (f"   [below 0.6: {', '.join(quiet)}]" if quiet else ""))
        rows.append({"photo": photo.name, "ms": round(ms), **json.loads(result.model_dump_json())})
    if times:
        print(f"\n{len(times)} photos · median {statistics.median(times):.0f} ms · worst {max(times):.0f} ms")
    (SAMPLES / "results.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "en"))
