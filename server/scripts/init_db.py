"""Create the hazard_reports table in Tiger Data (safe to run again).

    cd server && .venv/Scripts/python scripts/init_db.py      # Windows
    cd server && .venv/bin/python scripts/init_db.py          # macOS / Linux
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # ✅/❌ on a Windows console too
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
import db  # noqa: E402

if not config.DATABASE_URL:
    sys.exit("DATABASE_URL is not set in server/.env (Tiger Data connection string)")

print(f"✅ hazard_reports ready ({db.init_db()})")
