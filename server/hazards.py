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
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

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
    source: Literal["gemini", "fast_layer"] = "gemini"


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
