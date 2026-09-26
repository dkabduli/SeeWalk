"""Unit tests for the transcript check on voice-command intents (no network)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from listen import verified_intent  # noqa: E402


def test_needs_the_wake_word():
    assert verified_intent("holding", "What am I holding?") == "none"
    assert verified_intent("holding", "SeeWalk, what am I holding?") == "holding"


def test_accepts_dictation_spellings_of_seewalk():
    for heard in ["see walk what's ahead", "Sea walk, what's ahead?", "C walk what's in front of me", "Seawalk read this"]:
        assert verified_intent("read" if "read" in heard else "whats_ahead", heard) != "none", heard


def test_own_alert_misheard_as_cross_is_rejected():
    # SeeWalk's own "Bins ahead. Crosswalk ahead." came back as "SeeWalk, cross ahead."
    assert verified_intent("cross", "SeeWalk, cross ahead.") == "none"
    assert verified_intent("cross", "SeeWalk, is it safe to cross?") == "cross"
    assert verified_intent("cross", "SeeWalk, est-ce que je peux traverser ?") == "cross"


def test_each_command_needs_its_keyword():
    assert verified_intent("path", "SeeWalk, what's blocking my path?") == "path"
    assert verified_intent("path", "SeeWalk, qu'est-ce qui bloque mon chemin ?") == "path"
    assert verified_intent("read", "SeeWalk, lisez ceci") == "read"
    assert verified_intent("read", "SeeWalk, what does the sign say?") == "read"
    assert verified_intent("holding", "SeeWalk, qu'est-ce que je tiens ?") == "holding"
    assert verified_intent("path", "SeeWalk, hello") == "none"


def test_none_stays_none():
    assert verified_intent("none", "SeeWalk, what am I holding?") == "none"
