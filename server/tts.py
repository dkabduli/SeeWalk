import httpx

import config
from voices import resolve_voice

_cache: dict[tuple[str, str, str], bytes] = {}
_http = httpx.AsyncClient(timeout=10)


async def synthesize(text: str, lang: str = "en", voice: str = "river") -> bytes:
    voice_id = resolve_voice(voice)
    key = (text.strip().lower(), lang, voice_id)
    if key in _cache:
        return _cache[key]
    r = await _http.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        params={"output_format": "mp3_44100_64"},
        headers={"xi-api-key": config.ELEVENLABS_API_KEY},
        json={"text": text, "model_id": config.ELEVENLABS_TTS_MODEL, "language_code": lang},
    )
    r.raise_for_status()
    if len(_cache) >= 200:
        _cache.pop(next(iter(_cache)))
    _cache[key] = r.content
    return r.content
