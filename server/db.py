"""Tiger Data (PostgreSQL + TimescaleDB): sidewalk hazard reports for the civic hazard map.

The phone saves a report when Gemini sees a lasting sidewalk problem (pothole, broken pavement,
construction, ...) with high confidence, tagged with GPS and time. No photos, no people: only
what, where, when. Works on plain PostgreSQL too (the hypertable step is skipped).

    cd server && .venv/Scripts/python scripts/init_db.py    # once, creates the table
"""
import logging
import math
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

# Known hazards from open data (Ottawa 311 today): one row per report the city hasn't fixed yet.
# A plain table, replaced on every import; the walkers' own sightings stay in the hypertable.
CITY_TABLE = """
CREATE TABLE IF NOT EXISTS city_reports (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  hazard_type TEXT NOT NULL,
  label_en    TEXT NOT NULL,
  label_fr    TEXT NOT NULL,
  address     TEXT,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  opened      DATE,
  walkway     BOOLEAN NOT NULL DEFAULT true,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
)"""
CITY_WALKWAY = "ALTER TABLE city_reports ADD COLUMN IF NOT EXISTS walkway BOOLEAN NOT NULL DEFAULT true"
CITY_INDEX = "CREATE INDEX IF NOT EXISTS city_reports_latlon_idx ON city_reports (lat, lon)"

# What a walker hears for another walker's sighting ("Reported nearby: pothole").
WALKER_LABELS = {
    "pothole": ("pothole", "nid-de-poule"),
    "uneven_surface": ("uneven pavement", "chaussée inégale"),
    "obstacle_in_path": ("obstacle on the sidewalk", "obstacle sur le trottoir"),
    "construction": ("construction", "travaux"),
    "curb_or_dropoff": ("curb or drop-off", "bordure ou dénivelé"),
}

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
        conn.execute(CITY_TABLE)
        conn.execute(CITY_WALKWAY)  # tables made before the column existed
        conn.execute(CITY_INDEX)
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


def replace_city_reports(source: str, rows: list[dict]) -> dict:
    """Upsert this import and drop the source's rows that are no longer open. One transaction, so the
    map never shows a half-imported city. Returns {"kept": n, "removed": m}."""
    with connect() as conn, conn.transaction():
        started = conn.execute("SELECT now() AS t").fetchone()["t"]
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO city_reports (id, source, hazard_type, label_en, label_fr, address, lat, lon, opened, walkway, imported_at)
                VALUES (%(id)s, %(source)s, %(type)s, %(label_en)s, %(label_fr)s, %(address)s, %(lat)s, %(lon)s, %(opened)s,
                        %(walkway)s, now())
                ON CONFLICT (id) DO UPDATE SET hazard_type = EXCLUDED.hazard_type, label_en = EXCLUDED.label_en,
                  label_fr = EXCLUDED.label_fr, address = EXCLUDED.address, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
                  opened = EXCLUDED.opened, walkway = EXCLUDED.walkway, imported_at = now()
                """,
                [{**r, "source": source} for r in rows],
            )
        removed = conn.execute(
            "DELETE FROM city_reports WHERE source = %s AND imported_at < %s", (source, started)
        ).rowcount
    return {"kept": len(rows), "removed": removed}


def city_in_bbox(*, south: float, west: float, north: float, east: float, limit: int = 2000) -> list[dict]:
    """Open city reports inside the visible map area."""
    with connect() as conn:
        return conn.execute(
            """
            SELECT id, source, hazard_type AS type, label_en, label_fr, address, lat, lon, opened::text AS opened, walkway
            FROM city_reports WHERE lat BETWEEN %(s)s AND %(n)s AND lon BETWEEN %(w)s AND %(e)s
            ORDER BY opened DESC NULLS LAST LIMIT %(limit)s
            """,
            dict(s=south, n=north, w=west, e=east, limit=limit),
        ).fetchall()


def near(*, lat: float, lon: float, radius: float, exclude_session: str | None = None,
         walker_days: int = 14, walkway_only: bool = False) -> list[dict]:
    """Known hazards within `radius` metres, nearest first: open city reports, plus other walkers'
    sightings from the last `walker_days` (one per type per ~10 m spot; test pins left out).
    walkway_only leaves out problems out in the road (walk alerts)."""
    dlat = radius / 111320
    dlon = radius / (111320 * max(0.1, math.cos(math.radians(lat))))
    params = dict(lat=lat, lon=lon, radius=radius, s=lat - dlat, n=lat + dlat, w=lon - dlon, e=lon + dlon,
                  session=exclude_session or "", days=walker_days, walkway_only=walkway_only)
    with connect() as conn:
        city = conn.execute(
            f"""
            SELECT * FROM (
              SELECT id, source, hazard_type AS type, label_en, label_fr, address, lat, lon,
                     opened::text AS opened, walkway, {_METRES} AS metres
              FROM city_reports WHERE lat BETWEEN %(s)s AND %(n)s AND lon BETWEEN %(w)s AND %(e)s
                AND (walkway OR NOT %(walkway_only)s)
            ) c WHERE metres <= %(radius)s
            """,
            params,
        ).fetchall()
        walkers = conn.execute(
            f"""
            SELECT * FROM (
              SELECT *, {_METRES} AS metres FROM (
                SELECT hazard_type AS type, round(lat::numeric, 4)::float AS lat, round(lon::numeric, 4)::float AS lon,
                       count(DISTINCT session_id) AS walks, max(time)::date::text AS opened
                FROM hazard_reports
                WHERE time > now() - make_interval(days => %(days)s) AND source <> 'test'
                  AND session_id <> %(session)s
                  AND lat BETWEEN %(s)s AND %(n)s AND lon BETWEEN %(w)s AND %(e)s
                GROUP BY 1, 2, 3
              ) spots
            ) w WHERE metres <= %(radius)s
            """,
            params,
        ).fetchall()
    for w in walkers:
        en, fr = WALKER_LABELS.get(w["type"], (w["type"], w["type"]))
        w.update(id=f"walk:{w['type']}:{w['lat']}:{w['lon']}", source="walkers", label_en=en, label_fr=fr, address=None,
                 walkway=True)
    # Several 311 requests often describe one problem: keep one per kind per ~10 m spot, nearest first
    seen, out = set(), []
    for r in sorted([*city, *walkers], key=lambda r: r["metres"]):
        spot = (r["type"], r["label_en"], round(r["lat"], 4), round(r["lon"], 4))
        if spot not in seen:
            seen.add(spot)
            out.append(r)
    return out
