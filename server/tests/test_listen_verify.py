"""Unit tests for the transcript check on voice-command intents (no network)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from listen import answer_for, verified_intent  # noqa: E402


def test_needs_the_wake_word():
    assert verified_intent("holding", "What am I holding?") == "none"
    assert verified_intent("holding", "SeeWalk, what am I holding?") == "holding"


def test_accepts_vision_companion_and_the_old_name():
    assert verified_intent("whats_ahead", "Vision Companion, what's ahead?") == "whats_ahead"
    assert verified_intent("whats_ahead", "VisionCompanion what's ahead") == "whats_ahead"


def test_accepts_dictation_spellings_of_seewalk():
    for heard in ["see walk what's ahead", "Sea walk, what's ahead?", "C walk what's in front of me", "CWalk whats ahead", "Seawalk read this"]:
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


def test_path_questions_are_not_answered_here():
    assert answer_for("whats_ahead", "A door and a chair") == ""
    assert answer_for("path", "A chair ahead") == ""
    assert answer_for("holding", " A blue bottle ") == "A blue bottle"
    assert answer_for("read", "Sortie") == "Sortie"


def test_what_is_this_is_whats_ahead():
    # The hallway walk asked this in front of an elevator and the keyword check dropped it.
    assert verified_intent("whats_ahead", "SeeWalk, what is this?") == "whats_ahead"
    assert verified_intent("whats_ahead", "SeeWalk, what's that?") == "whats_ahead"
    assert verified_intent("whats_ahead", "SeeWalk, c'est quoi ?") == "whats_ahead"


def test_where_was_is_answered_from_memory_not_a_new_look():
    assert verified_intent("where", "SeeWalk, where was the elevator?") == "where"
    assert verified_intent("whats_ahead", "SeeWalk, where was the elevator?") == "where"
    assert verified_intent("none", "SeeWalk, où était l'ascenseur ?") == "where"
    assert verified_intent("whats_ahead", "SeeWalk, what's ahead?") == "whats_ahead"


def test_none_stays_none():
    assert verified_intent("none", "SeeWalk, what am I holding?") == "none"


def test_french_dictation_of_the_wake_word_and_french_phrasings():
    # French speech comes back as "Cewalk" / "C'est walk" (French-mode test with River's voice)
    assert verified_intent("holding", "Cewalk, qu'est-ce que j'ai dans la main?") == "holding"
    assert verified_intent("holding", "Ciwalk, qu'est-ce que je tiens ?") == "holding"
    assert verified_intent("holding", "C'est walk, qu'est-ce que je tiens ?") == "holding"
    assert verified_intent("whats_ahead", "SeeWalk, qu'est-ce qu'il y a?") == "whats_ahead"
    assert verified_intent("whats_ahead", "SeeWalk, qu'y a-t-il devant ?") == "whats_ahead"
    assert verified_intent("whats_ahead", "Cette walk qu'il y a") == "none"   # no wake word
