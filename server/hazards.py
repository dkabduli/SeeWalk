"""Hazard map API (Tiger Data). Saving is best-effort: the walk never waits on or fails because
of the map, so the phone fires POST /hazards and ignores the answer.

Aroha: add to main.py
    from hazards import router as hazards_router
    app.include_router(hazards_router)
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

import psycopg
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

import briefing
import city311
import config
import db

log = logging.getLogger("seewalk")
router = APIRouter()

# Only confident sightings go on the map ("never guess" applies to the city's map too).
MIN_CONFIDENCE = 0.7

MapType = Literal["pothole", "uneven_surface", "obstacle_in_path", "construction", "curb_or_dropoff"]


class HazardReport(BaseModel):
    session_id: str = Field(min_length=1, max_length=64, description="random id per walk, not per person")
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    type: MapType
    confidence: float = Field(ge=0, le=1)
    source: Literal["gemini", "fast_layer", "test"] = "gemini"  # test: pins dropped by hand from the map page


class SaveResult(BaseModel):
    saved: bool
    reason: Literal["saved", "duplicate", "low_confidence"]


def _require_db():
    if not db.enabled():
        raise HTTPException(503, "Hazard map is off (DATABASE_URL not set)")


def _since(days: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


@router.post("/hazards", response_model=SaveResult)
def save_hazard(report: HazardReport):
    _require_db()
    if report.confidence < MIN_CONFIDENCE:
        return SaveResult(saved=False, reason="low_confidence")
    try:
        row = db.save_report(session_id=report.session_id, lat=report.lat, lon=report.lon,
                             hazard_type=report.type, confidence=report.confidence, source=report.source)
    except psycopg.Error as e:
        log.warning("hazard save failed: %s", e)
        raise HTTPException(503, "Hazard map database unavailable")
    return SaveResult(saved=row is not None, reason="saved" if row else "duplicate")


@router.get("/hazards")
def get_hazards(days: float = Query(7, gt=0, le=365), types: list[MapType] | None = Query(None)):
    _require_db()
    try:
        rows = db.list_reports(since=_since(days), types=types)
    except psycopg.Error as e:
        log.warning("hazard list failed: %s", e)
        raise HTTPException(503, "Hazard map database unavailable")
    return {"hazards": rows}


@router.get("/hazards/hotspots")
def get_hotspots(days: float = Query(7, gt=0, le=365), limit: int = Query(10, ge=1, le=100)):
    _require_db()
    try:
        return {"hotspots": db.hotspots(since=_since(days), limit=limit)}
    except psycopg.Error as e:
        log.warning("hotspots failed: %s", e)
        raise HTTPException(503, "Hazard map database unavailable")


# ---------- Known hazards from open data (Ottawa 311) ----------

@router.get("/hazards/city")
def get_city_reports(south: float = Query(ge=-90, le=90), west: float = Query(ge=-180, le=180),
                     north: float = Query(ge=-90, le=90), east: float = Query(ge=-180, le=180)):
    """Open 311 reports in the visible map area."""
    _require_db()
    if north <= south or east <= west or north - south > 1 or east - west > 1:
        raise HTTPException(422, "Zoom in: the area is at most 1 degree across")
    try:
        return {"reports": db.city_in_bbox(south=south, west=west, north=north, east=east)}
    except psycopg.Error as e:
        log.warning("city reports failed: %s", e)
        raise HTTPException(503, "Hazard map database unavailable")


@router.get("/hazards/near")
def get_near(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
             radius: float = Query(60, gt=0, le=100), session_id: str = Query("", max_length=64)):
    """Known hazards around the walker, nearest first: open city reports + other walkers' sightings."""
    _require_db()
    try:
        return {"near": db.near(lat=lat, lon=lon, radius=radius, exclude_session=session_id or None, walkway_only=True)}
    except psycopg.Error as e:
        log.warning("near failed: %s", e)
        raise HTTPException(503, "Hazard map database unavailable")


class BriefingRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    lang: Literal["en", "fr"] = "en"


@router.post("/hazards/briefing")
async def post_briefing(req: BriefingRequest):
    """One or two spoken sentences about the reported problems within 300 m (Gemini, from real data)."""
    _require_db()
    try:
        return await briefing.brief(req.lat, req.lon, req.lang)
    except psycopg.Error as e:
        log.warning("briefing failed: %s", e)
        raise HTTPException(503, "Hazard map database unavailable")


@router.get("/hazards/city/refresh")
def refresh_city(authorization: str = Header("")):
    """Daily Vercel Cron: re-import Ottawa's open 311 reports. Off unless CRON_SECRET is set."""
    if not config.CRON_SECRET or authorization != f"Bearer {config.CRON_SECRET}":
        raise HTTPException(401, "Not allowed")
    _require_db()
    try:
        return city311.refresh()
    except Exception as e:  # download, CSV format or database: report it, keep yesterday's data
        log.warning("311 refresh failed: %s", e)
        raise HTTPException(502, f"311 refresh failed: {type(e).__name__}")
