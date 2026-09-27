"""Import the City of Ottawa's open 311 sidewalk reports into Tiger Data (safe to run again).

Keeps only open reports with GPS that matter to a blind walker (see server/city311.py). On Vercel
the same import runs daily through the cron route /api/hazards/city/refresh.

    cd server && .venv/Scripts/python scripts/import_311.py      # Windows
    cd server && .venv/bin/python scripts/import_311.py          # macOS / Linux
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # ✅/❌ on a Windows console too
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import city311  # noqa: E402
import config  # noqa: E402
import db  # noqa: E402

if not config.DATABASE_URL:
    sys.exit("DATABASE_URL is not set in server/.env (Tiger Data connection string)")

db.init_db()
result = city311.refresh()
print(f"✅ Ottawa 311: {result['kept']} open reports kept, {result['removed']} fixed ones removed")
for kind, n in sorted(result["by_type"].items(), key=lambda kv: -kv[1]):
    print(f"   {kind:<17} {n}")
