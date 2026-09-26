"""The voice picker maps a slug to an ElevenLabs id. Unknown slugs stay River."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config  # noqa: E402
from voices import resolve_voice  # noqa: E402


def test_the_three_added_voices_resolve():
    assert resolve_voice("alice") != config.ELEVENLABS_VOICE_ID
    assert resolve_voice("charlie") != resolve_voice("alice")
    assert resolve_voice("moyo") not in (resolve_voice("alice"), resolve_voice("charlie"))


def test_anything_else_is_river():
    assert resolve_voice("river") == config.ELEVENLABS_VOICE_ID
    assert resolve_voice(None) == config.ELEVENLABS_VOICE_ID
    assert resolve_voice("someone") == config.ELEVENLABS_VOICE_ID
