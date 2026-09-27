"""Area briefing: Gemini rewords real reports; anything off falls back to a plain summary."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import briefing  # noqa: E402
import config  # noqa: E402
import db  # noqa: E402

ITEMS = [
    {"source": "ottawa_311", "type": "uneven_surface", "label_en": "lifted or sunken sidewalk panel",
     "label_fr": "dalle de trottoir soulevée ou affaissée", "address": "75 Laurier Ave E", "metres": 40.0},
    {"source": "ottawa_311", "type": "uneven_surface", "label_en": "lifted or sunken sidewalk panel",
     "label_fr": "dalle de trottoir soulevée ou affaissée", "address": "90 Laurier Ave E", "metres": 120.0},
    {"source": "walkers", "type": "pothole", "label_en": "pothole", "label_fr": "nid-de-poule", "address": None, "metres": 200.0},
]
ROAD = [
    {"source": "ottawa_311", "type": "pothole", "label_en": "pothole in the road", "label_fr": "nid-de-poule dans la rue",
     "address": "1 Colonel By Dr", "metres": 10.0 + i, "walkway": False}
    for i in range(5)
]


def gemini_says(monkeypatch, text=None, error=None):
    prompts = []

    async def create(**kw):
        prompts.append(kw["input"][0]["text"])
        if error:
            raise error
        return SimpleNamespace(output_text=text)

    monkeypatch.setattr(config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(briefing, "_client", SimpleNamespace(aio=SimpleNamespace(interactions=SimpleNamespace(create=create))))
    return prompts


@pytest.fixture(autouse=True)
def reports(monkeypatch):
    monkeypatch.setattr(db, "near", lambda **kw: list(ITEMS))


def run(lang="en"):
    return asyncio.run(briefing.brief(45.42, -75.68, lang))


def test_gemini_rewords_only_the_real_reports(monkeypatch):
    prompts = gemini_says(monkeypatch, "Two lifted sidewalk panels on Laurier Avenue East, and a pothole walkers reported nearby.")
    out = run()
    assert out == {"text": "Two lifted sidewalk panels on Laurier Avenue East, and a pothole walkers reported nearby.",
                   "count": 3, "by": "gemini"}
    assert "75 Laurier Ave E" in prompts[0] and "ONLY" in prompts[0] and "never say the area is clear" in prompts[0]


@pytest.mark.parametrize("bad", ["The area is clear, walk safely.", "", "x" * 400])
def test_unsafe_or_odd_answers_fall_back(monkeypatch, bad):
    gemini_says(monkeypatch, bad)
    out = run()
    assert out["by"] == "plain"
    assert out["text"] == "3 reported problems within 300 metres: lifted or sunken sidewalk panel (2), pothole (1)."


def test_english_answer_in_french_mode_falls_back(monkeypatch):
    gemini_says(monkeypatch, "There are two lifted sidewalk panels on the street ahead of you.")
    out = run("fr")
    assert out["by"] == "plain" and out["text"].startswith("3 problèmes signalés")


def test_gemini_down_falls_back(monkeypatch):
    gemini_says(monkeypatch, error=TimeoutError())
    assert run()["by"] == "plain"


def test_sidewalk_problems_come_before_many_road_potholes(monkeypatch):
    monkeypatch.setattr(db, "near", lambda **kw: ROAD + list(ITEMS))  # road ones are nearer and more numerous
    out = run()
    assert out["text"] == ("8 reported problems within 300 metres: lifted or sunken sidewalk panel (2), pothole (1), "
                           "pothole in the road (5).")


def test_nothing_reported_never_says_clear(monkeypatch):
    monkeypatch.setattr(db, "near", lambda **kw: [])
    for lang in ("en", "fr"):
        out = run(lang)
        assert out["count"] == 0 and out["by"] == "plain"
        assert "clear" not in out["text"].lower() and "sûr" not in out["text"].lower()
