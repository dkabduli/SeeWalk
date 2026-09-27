"""Hazard map API (hazards.py) without a database: db is faked, so this runs anywhere."""
import sys
from pathlib import Path

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db  # noqa: E402
import hazards  # noqa: E402

REPORT = {"session_id": "walk-1", "lat": 45.4215, "lon": -75.6972, "type": "pothole", "confidence": 0.9}


@pytest.fixture
def client(monkeypatch):
    saved: list[dict] = []
    monkeypatch.setattr(db, "enabled", lambda: True)

    def save_report(**kw):
        saved.append(kw)
        return {"id": "x", "time": "now"}

    monkeypatch.setattr(db, "save_report", save_report)
    app = FastAPI()
    app.include_router(hazards.router)
    c = TestClient(app)
    c.saved = saved
    return c


def test_confident_report_is_saved(client):
    r = client.post("/hazards", json=REPORT)
    assert r.json() == {"saved": True, "reason": "saved"}
    assert client.saved == [dict(session_id="walk-1", lat=45.4215, lon=-75.6972, hazard_type="pothole",
                                 confidence=0.9, source="gemini")]


def test_duplicate_is_not_saved(client, monkeypatch):
    monkeypatch.setattr(db, "save_report", lambda **kw: None)  # the SQL found one nearby
    assert client.post("/hazards", json=REPORT).json() == {"saved": False, "reason": "duplicate"}


def test_low_confidence_never_touches_the_database(client):
    r = client.post("/hazards", json={**REPORT, "confidence": 0.5})
    assert r.json() == {"saved": False, "reason": "low_confidence"}
    assert client.saved == []


@pytest.mark.parametrize("bad", [{"type": "car"}, {"type": "stop_sign"}, {"lat": 91}, {"confidence": 1.5}, {"session_id": ""}])
def test_not_map_material_is_rejected(client, bad):
    assert client.post("/hazards", json={**REPORT, **bad}).status_code == 422
    assert client.saved == []


def test_map_off_without_database_url(client, monkeypatch):
    monkeypatch.setattr(db, "enabled", lambda: False)
    for r in (client.post("/hazards", json=REPORT), client.get("/hazards"), client.get("/hazards/hotspots")):
        assert r.status_code == 503


def test_database_down_is_503_not_a_crash(client, monkeypatch):
    def down(**kw):
        raise psycopg.OperationalError("timeout")

    for name in ("save_report", "list_reports", "hotspots"):
        monkeypatch.setattr(db, name, down)
    assert client.post("/hazards", json=REPORT).status_code == 503
    assert client.get("/hazards").status_code == 503
    assert client.get("/hazards/hotspots").status_code == 503


def test_list_and_hotspots_pass_filters(client, monkeypatch):
    seen = {}

    def list_reports(**kw):
        seen["list"] = kw
        return [{"type": "pothole"}]

    def hotspots(**kw):
        seen["hot"] = kw
        return [{"walks": 2}]

    monkeypatch.setattr(db, "list_reports", list_reports)
    monkeypatch.setattr(db, "hotspots", hotspots)
    assert client.get("/hazards?days=1&types=pothole&types=construction").json() == {"hazards": [{"type": "pothole"}]}
    assert seen["list"]["types"] == ["pothole", "construction"]
    assert client.get("/hazards/hotspots?days=30&limit=5").json() == {"hotspots": [{"walks": 2}]}
    assert seen["hot"]["limit"] == 5


def test_every_server_serves_the_map():
    """main.py (laptop and Vercel) includes the hazard routes."""
    main = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
    assert "app.include_router(hazards_router)" in main


# ---------- open data routes ----------

def test_city_reports_for_the_visible_area(client, monkeypatch):
    monkeypatch.setattr(db, "city_in_bbox", lambda **kw: [{"id": "311:1", **kw}])
    r = client.get("/hazards/city?south=45.41&west=-75.70&north=45.43&east=-75.67")
    assert r.json()["reports"][0]["north"] == 45.43
    assert client.get("/hazards/city?south=45&west=-76&north=47&east=-75").status_code == 422  # too big
    assert client.get("/hazards/city?south=45.43&west=-75.70&north=45.41&east=-75.67").status_code == 422  # upside down


def test_near_passes_the_walk_so_it_skips_its_own_sightings(client, monkeypatch):
    seen = {}

    def near(**kw):
        seen.update(kw)
        return [{"id": "311:1", "metres": 12.0}]

    monkeypatch.setattr(db, "near", near)
    assert client.get("/hazards/near?lat=45.42&lon=-75.68&session_id=walk-1").json() == {"near": [{"id": "311:1", "metres": 12.0}]}
    assert seen == {"lat": 45.42, "lon": -75.68, "radius": 60, "exclude_session": "walk-1", "walkway_only": True}
    assert client.get("/hazards/near?lat=45.42&lon=-75.68&radius=500").status_code == 422


def test_briefing_route(client, monkeypatch):
    async def brief(lat, lon, lang):
        return {"text": f"{lang} ok", "count": 0, "by": "plain"}

    monkeypatch.setattr(hazards.briefing, "brief", brief)
    assert client.post("/hazards/briefing", json={"lat": 45.42, "lon": -75.68, "lang": "fr"}).json()["text"] == "fr ok"
    assert client.post("/hazards/briefing", json={"lat": 45.42, "lon": -75.68, "lang": "de"}).status_code == 422


def test_cron_refresh_needs_the_secret(client, monkeypatch):
    monkeypatch.setattr(hazards.city311, "refresh", lambda: {"kept": 3, "removed": 1, "by_type": {}})
    monkeypatch.setattr(hazards.config, "CRON_SECRET", "")
    assert client.get("/hazards/city/refresh", headers={"Authorization": "Bearer "}).status_code == 401  # off when unset
    monkeypatch.setattr(hazards.config, "CRON_SECRET", "s3cret")
    assert client.get("/hazards/city/refresh").status_code == 401
    assert client.get("/hazards/city/refresh", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/hazards/city/refresh", headers={"Authorization": "Bearer s3cret"}).json()["kept"] == 3
