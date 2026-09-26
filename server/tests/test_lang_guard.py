import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lang_guard  # noqa: E402
from lang_guard import in_language, looks_english  # noqa: E402

# English slips seen in French mode (lab log 18:41, French sample eval)
ENGLISH = [
    "a large table with red chairs behind",
    "Large open sidewalk ahead",
    "Lamppost on your left, bus stop sign ahead",
    "Lamppost on the left",
    "Door ahead",
    "Nothing detected in your path",
    "I can't see anything in your hand",
]
# Real French answers, including ones with borrowed words (STOP, SeeWalk)
FRENCH = [
    "Grandes poubelles sur le trottoir",
    "Poubelles devant",
    "Panneau STOP devant",
    "Personne à gauche",
    "Un couloir avec deux personnes à gauche.",
    "Porte à droite",
    "Rien de détecté sur votre chemin",
    "Je ne vois rien dans votre main",
    "Une bouteille d'eau bleue",
    "Escalier qui descend",
    "Nid-de-poule devant",
    "Feu de circulation devant",
]


@pytest.mark.parametrize("text", ENGLISH)
def test_english_is_caught(text):
    assert looks_english(text)


@pytest.mark.parametrize("text", FRENCH)
def test_french_is_left_alone(text):
    assert not looks_english(text)


def test_english_mode_and_french_text_never_translate(monkeypatch):
    async def boom(*_):
        raise AssertionError("must not translate")

    monkeypatch.setattr(lang_guard, "translate", boom)
    assert asyncio.run(in_language("Door ahead", "en")) == "Door ahead"
    assert asyncio.run(in_language("Porte devant", "fr")) == "Porte devant"
    assert asyncio.run(in_language("", "fr")) == ""


def test_english_in_french_mode_is_translated(monkeypatch):
    async def fake(text, lang):
        return "Porte devant"

    monkeypatch.setattr(lang_guard, "translate", fake)
    assert asyncio.run(in_language("Door ahead", "fr")) == "Porte devant"
