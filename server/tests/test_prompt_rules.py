"""The corridor rules live in the prompt. Removing one of these sentences is a behavior change."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gemini import CAREFUL_NOTE, PROMPT  # noqa: E402

RULES = " ".join(PROMPT.split())


def test_a_door_counts_only_when_the_corridor_ends_at_it():
    assert "the corridor ends at" in RULES
    assert "on the left or the right, is not a door" in RULES
    assert "always include it, even when a button post or bollard is closer" in RULES
    assert "door_open" in RULES and "door_opening" in RULES
    assert "Door opening ahead" in RULES
    assert "Elevator doors are never a door" in RULES
    assert "Sliding metal doors indoors" in RULES


def test_a_wide_pillar_is_not_a_thin_pole():
    assert "or a sign post is never a pillar" in RULES
    assert "If you are not sure it is a column, leave it out" in RULES
    assert "open space on both sides" in RULES
    assert "A pole on the grass" in RULES
    assert "A blurry sign is not a pole" in RULES
    assert "A chair against a wall" in RULES
    assert "sticking out from a wall into the corridor" in RULES


def test_a_question_looks_again_for_an_elevator():
    assert "never a door" in CAREFUL_NOTE
    assert "call button" in CAREFUL_NOTE


def test_whats_ahead_names_the_scene_and_not_just_a_person():
    assert "speaks a real hazard first" in RULES
    assert "A person does not replace the summary" in RULES
    assert "water fountain" in RULES


def test_stop_signs_are_not_held_to_the_corridor_rule():
    # Stop signs stand at the curb, never in the corridor; the corridor rule used to hide them
    assert "Stop signs and traffic lights are the exception" in RULES
    assert "a clearly visible stop sign is never left out" in RULES
    assert "a clearly visible stop sign is always one of the 3" in RULES
    assert "a triangular yield sign is not a stop sign" in RULES


def test_people_in_the_corridor_are_reported_but_never_described():
    assert "someone standing or walking in the corridor within ~6 m" in RULES
    assert "People off to the side, on another sidewalk, or farther away are left out" in RULES
    assert "never describe how anyone looks" in RULES


def test_crosswalk_wording_is_unchanged():
    # Crosswalks work well in testing: keep this exact rule
    assert "crosswalk: painted crossing lines on the road ahead." in RULES
    assert "Report these three even if they are at the edge of the image, as long as they are clearly visible." in RULES
