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
