"""Tiger Data (PostgreSQL + TimescaleDB): sidewalk hazard reports for the civic hazard map.

The phone saves a report when Gemini sees a lasting sidewalk problem (pothole, broken pavement,
construction, ...) with high confidence, tagged with GPS and time. No photos, no people: only
what, where, when. Works on plain PostgreSQL too (the hypertable step is skipped).

    cd server && .venv/Scripts/python scripts/init_db.py    # once, creates the table
"""
import logging
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

import config

log = logging.getLogger("seewalk")

# Hazards that stay put and are worth fixing. People, cars, stop signs... are not map material.
MAP_TYPES = ("pothole", "uneven_surface", "obstacle_in_path", "construction", "curb_or_dropoff")

# Dedupe: the same walker passing the same pothole saves it once, not every 1.5 s.
DEDUPE_METRES = 15
DEDUPE_MINUTES = 5

_COLUMNS = """
  time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  id          UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  hazard_type TEXT NOT NULL,
  confidence  REAL NOT NULL,
  source      TEXT NOT NULL DEFAULT 'gemini'
"""
# Tiger Cloud (current TimescaleDB): a hypertable partitioned by time, compressed per hazard type.
HYPERTABLE = f"""
CREATE TABLE IF NOT EXISTS hazard_reports ({_COLUMNS}) WITH (
  tsdb.hypertable,
  tsdb.segmentby = 'hazard_type',
  tsdb.orderby = 'time DESC'
)"""
PLAIN_TABLE = f"CREATE TABLE IF NOT EXISTS hazard_reports ({_COLUMNS})"
INDEX = "CREATE INDEX IF NOT EXISTS hazard_reports_session_idx ON hazard_reports (session_id, hazard_type, time DESC)"

# Metres between two points (equirectangular: plenty accurate at street scale).
_METRES = "111320 * sqrt(power(lat - %(lat)s, 2) + power(cos(radians(%(lat)s)) * (lon - %(lon)s), 2))"

_INSERT = f"""
INSERT INTO hazard_reports (session_id, lat, lon, hazard_type, confidence, source)
SELECT %(session_id)s, %(lat)s, %(lon)s, %(hazard_type)s, %(confidence)s, %(source)s
WHERE NOT EXISTS (
  SELECT 1 FROM hazard_reports
  WHERE session_id = %(session_id)s AND hazard_type = %(hazard_type)s
    AND time > now() - make_interval(mins => {DEDUPE_MINUTES})
    AND {_METRES} < {DEDUPE_METRES}
)
RETURNING id, time
"""


def enabled() -> bool:
    return bool(config.DATABASE_URL)


def connect() -> psycopg.Connection:
    return psycopg.connect(config.DATABASE_URL, autocommit=True, connect_timeout=5, row_factory=dict_row)


def init_db() -> str:
    """Create the table (idempotent). Returns how it was stored: 'hypertable' or 'table'."""
    with connect() as conn:
        try:
            conn.execute(HYPERTABLE)
        except psycopg.Error as e:  # plain PostgreSQL (local testing): a normal table is fine
            log.info("TimescaleDB not available, using a plain table: %s", e)
            conn.execute(PLAIN_TABLE)
        conn.execute(INDEX)
        # Check what really exists (IF NOT EXISTS keeps an older plain table as it was)
        has_tsdb = conn.execute("SELECT to_regclass('timescaledb_information.hypertables') AS t").fetchone()["t"]
        if has_tsdb and conn.execute(
            "SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'hazard_reports'"
        ).fetchone():
            return "hypertable"
        return "table"


def save_report(*, session_id: str, lat: float, lon: float, hazard_type: str,
                confidence: float, source: str = "gemini") -> dict | None:
    """Save one report. Returns {id, time}, or None if it duplicates a recent one nearby."""
    params = dict(session_id=session_id, lat=lat, lon=lon, hazard_type=hazard_type,
                  confidence=confidence, source=source)
    with connect() as conn:
        return conn.execute(_INSERT, params).fetchone()


def list_reports(*, since: datetime, types: list[str] | None = None, limit: int = 2000) -> list[dict]:
    """Newest first: everything the map shows."""
    with connect() as conn:
        return conn.execute(
            """
            SELECT id, time, lat, lon, hazard_type AS type, confidence, source FROM hazard_reports
            WHERE time >= %(since)s AND (%(types)s::text[] IS NULL OR hazard_type = ANY(%(types)s))
            ORDER BY time DESC LIMIT %(limit)s
            """,
            dict(since=since, types=types, limit=limit),
        ).fetchall()


def hotspots(*, since: datetime, limit: int = 10) -> list[dict]:
    """Most-reported spots: reports grouped into ~100 m cells, with how many walks saw each."""
    with connect() as conn:
        return conn.execute(
            """
            SELECT round(lat::numeric, 3)::float AS lat, round(lon::numeric, 3)::float AS lon,
                   count(*) AS reports, count(DISTINCT session_id) AS walks,
                   mode() WITHIN GROUP (ORDER BY hazard_type) AS top_type, max(time) AS last_seen
            FROM hazard_reports WHERE time >= %(since)s
            GROUP BY 1, 2 ORDER BY walks DESC, reports DESC LIMIT %(limit)s
            """,
            dict(since=since, limit=limit),
        ).fetchall()
