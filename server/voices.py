"""The voices a walker can pick. River is the default and already has every clip.

The other three are premade ElevenLabs voices from different parts of the world.
Street alerts for them are pre-generated, same phrases, so picking one stays instant.
"""
import config

# slug → ElevenLabs voice id. River uses the id in server/.env.
VOICES: dict[str, str] = {
    "alice": "Xb7hH8MSUJpSbSDYk0k2",    # Britain
    "charlie": "IKne3meq5aSn9XLyUdCD",  # Australia
    "moyo": "ilWiv7gEzrCtQ2zDJsRl",     # Nigeria
}


def resolve_voice(slug: str | None) -> str:
    """ElevenLabs id for a picker slug. Anything else is River."""
    if slug and slug in VOICES:
        return VOICES[slug]
    return config.ELEVENLABS_VOICE_ID
