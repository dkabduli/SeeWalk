"""City of Ottawa 311 open data → known sidewalk hazards for the map and the walk.

The city publishes every 311 service request of the year as one CSV, updated daily, with GPS for
most of them. We keep only what a blind or low-vision walker needs to know about and only what the
city hasn't fixed yet (Status = Active): potholes, lifted or broken sidewalk, broken curbs, branches
hanging over the sidewalk, and crossings whose pedestrian or audible signal is broken.

    cd server && .venv/Scripts/python scripts/import_311.py      # or the daily Vercel Cron
"""
import csv
import io
import logging
from collections.abc import Iterable, Iterator

import httpx

log = logging.getLogger("seewalk")

SOURCE = "ottawa_311"
CSV_URL = "https://311opendatastorage.blob.core.windows.net/311data/311opendata_currentyear.csv"

_SW = "Road Maintenance - Sidewalk/Pathways/Trails "
_CURB = "Road Maintenance - Curb/Gutter "
_SIGNAL = "Traffic Operations - Signal "

# English half of the 311 description → (map type, what the walker hears in EN, in FR).
# Exact matches only: an unknown kind of request is left out rather than guessed at.
RULES: dict[str, tuple[str, str, str]] = {
    _SW + "Pothole": ("pothole", "pothole in the sidewalk", "nid-de-poule sur le trottoir"),
    "Road Maintenance - Travelled Surface Pothole": ("pothole", "pothole in the road", "nid-de-poule dans la rue"),
    "Road Maintenance - Shoulder Pothole": ("pothole", "pothole on the road shoulder", "nid-de-poule sur l'accotement"),
    _SW + "Panel Lifted/Sunken": ("uneven_surface", "lifted or sunken sidewalk panel", "dalle de trottoir soulevée ou affaissée"),
    _SW + "Sunken/Raised": ("uneven_surface", "sunken or raised sidewalk", "trottoir affaissé ou soulevé"),
    _SW + "Broken/Missing": ("uneven_surface", "broken sidewalk", "trottoir brisé"),
    _SW + "Metal Bar (rebar) Exposed": ("uneven_surface", "metal bar sticking out of the sidewalk", "barre de métal qui dépasse du trottoir"),
    "Road Maintenance - Travelled Surface Sunken/Raised": ("uneven_surface", "sunken or raised road surface", "chaussée affaissée ou soulevée"),
    "Road Maintenance - Travelled Surface Depression": ("uneven_surface", "dip in the road", "affaissement dans la rue"),
    _CURB + "Damaged/Destroyed": ("curb_or_dropoff", "damaged curb", "bordure endommagée"),
    _CURB + "Sunken/Raised": ("curb_or_dropoff", "sunken or raised curb", "bordure affaissée ou soulevée"),
    _CURB + "Broken/Missing": ("curb_or_dropoff", "broken curb", "bordure brisée"),
    _CURB + "Lip Too High At Driveway": ("curb_or_dropoff", "high curb lip at a driveway", "rebord de bordure élevé à une entrée"),
    _CURB + "Depression": ("curb_or_dropoff", "dip at the curb", "affaissement à la bordure"),
    _SW + "Branches Overhanging": ("obstacle_in_path", "branches hanging over the sidewalk", "branches au-dessus du trottoir"),
    "Park Maintenance - Sidewalk/Pathways/Trails Hazard On Trail": ("obstacle_in_path", "hazard on the path", "danger sur le sentier"),
    _SIGNAL + "Pedestrian Head": ("crossing_signal", "broken walk signal at the crossing", "feu pour piétons brisé à la traverse"),
    _SIGNAL + "Audible": ("crossing_signal", "audible crossing signal not working", "signal sonore de traverse en panne"),
    _SIGNAL + "Push Button": ("crossing_signal", "crossing push button not working", "bouton de traverse en panne"),
}

# Out in the road, not underfoot on the sidewalk: shown on the map and last in the briefing, but never
# a walk alert (walking beside a busy road would otherwise mean an alert every few steps).
ROAD = {"Road Maintenance - " + kind for kind in (
    "Travelled Surface Pothole", "Shoulder Pothole", "Travelled Surface Sunken/Raised", "Travelled Surface Depression",
)}

_NULL = "\\N"


def parse(lines: Iterable[str]) -> Iterator[dict]:
    """Rows of the 311 CSV (header first) → open, located, walker-relevant reports."""
    reader = csv.reader(lines)
    header = [h.split(" | ")[0].strip().lstrip("﻿") for h in next(reader)]
    col = {name: i for i, name in enumerate(header)}
    need = ("Service Request ID", "Status", "Description", "Opened Date", "Address", "Latitude", "Longitude")
    missing = [n for n in need if n not in col]
    if missing:
        raise ValueError(f"311 CSV columns changed, missing {missing}")
    for row in reader:
        if len(row) < len(header) or row[col["Status"]] != "Active":
            continue
        kind = row[col["Description"]].split(" | ")[0].strip()
        rule = RULES.get(kind)
        lat, lon = row[col["Latitude"]], row[col["Longitude"]]
        if not rule or _NULL in (lat, lon) or not lat or not lon:
            continue
        try:
            lat_f, lon_f = float(lat), float(lon)
        except ValueError:
            continue
        opened = row[col["Opened Date"]]
        address = row[col["Address"]]
        yield {
            "id": f"311:{row[col['Service Request ID']]}",
            "type": rule[0], "label_en": rule[1], "label_fr": rule[2],
            "address": None if address == _NULL else address,
            "lat": lat_f, "lon": lon_f,
            "opened": None if opened == _NULL else opened[:10],
            "walkway": kind not in ROAD,
        }


def download(url: str = CSV_URL, timeout: float = 45) -> list[dict]:
    """Stream the city's CSV (~45 MB) and keep the relevant open reports (a few thousand)."""
    with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as r:
        r.raise_for_status()
        text = io.TextIOWrapper(io.BufferedReader(_ByteStream(r.iter_bytes())), encoding="utf-8-sig", newline="")
        return list(parse(text))


def refresh() -> dict:
    """Download and replace Ottawa's open reports in Tiger Data. Returns counts."""
    import db  # the import script and the cron route both need the database; parse() doesn't

    rows = download()
    result = db.replace_city_reports(SOURCE, rows)
    by_type: dict[str, int] = {}
    for r in rows:
        by_type[r["type"]] = by_type.get(r["type"], 0) + 1
    log.info("311 import: %s %s", result, by_type)
    return {**result, "by_type": by_type}


class _ByteStream(io.RawIOBase):
    """Lets csv read httpx's byte chunks as a file, without holding 45 MB in memory."""

    def __init__(self, chunks: Iterator[bytes]):
        self._chunks = chunks
        self._buf = b""

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        while not self._buf:
            try:
                self._buf = next(self._chunks)
            except StopIteration:
                return 0
        n = min(len(b), len(self._buf))
        b[:n] = self._buf[:n]
        self._buf = self._buf[n:]
        return n
