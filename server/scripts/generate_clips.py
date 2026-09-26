"""Generate the bundled ElevenLabs clip library (EN + FR) into web/public/audio/.

  python server/scripts/generate_clips.py                # generate missing clips
  python server/scripts/generate_clips.py --force        # regenerate everything
  python server/scripts/generate_clips.py --list-voices  # print available voices
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config  # noqa: E402

import httpx  # noqa: E402

from phrases import PHRASES  # noqa: E402
from voices import VOICES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
AUDIO_DIR = ROOT / "web" / "public" / "audio"
MANIFEST = ROOT / "web" / "src" / "audio" / "clips.json"
API = "https://api.elevenlabs.io/v1"
MODEL_ID = "eleven_multilingual_v2"
# What a walk actually says, besides River (who already has every clip): street alerts and the
# short system lines. Questions are live speech, so they follow the picker without a clip.
WALK_KEYS = {
    "walk_started", "walk_stopped", "unclear", "nothing_detected", "not_sure",
    "no_connection", "connection_back", "camera_blocked", "cross_refusal", "intro",
}


def list_voices(headers: dict) -> None:
    voices = httpx.get(f"{API}/voices", headers=headers, timeout=15).json()["voices"]
    for v in voices:
        labels = v.get("labels", {})
        print(f'{v["voice_id"]}  {v["name"]:<40} {labels.get("gender", ""):<8} {labels.get("accent", "")}')


def synthesize(client: httpx.Client, voice_id: str, text: str, lang: str) -> bytes:
    for attempt in range(5):
        r = client.post(
            f"{API}/text-to-speech/{voice_id}",
            params={"output_format": "mp3_44100_128"},
            json={
                "text": text,
                "model_id": MODEL_ID,
                "language_code": lang,
                "voice_settings": {"stability": 0.6, "similarity_boost": 0.75},
            },
        )
        if r.status_code == 429 and attempt < 4:
            time.sleep(2 ** attempt)
            continue
        # "Walk mode off" is refused for some voices; the same words with a stop are accepted.
        if r.status_code == 403 and "content_against_policy" in r.text and not text.endswith("."):
            text = text + "."
            continue
        r.raise_for_status()
        return r.content
    raise RuntimeError("tts retries exhausted")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-voices", action="store_true")
    parser.add_argument("--force", action="store_true", help="regenerate clips that already exist")
    parser.add_argument("--voice", choices=["river", *VOICES], help="which picker voice to render (default: river)")
    args = parser.parse_args()

    headers = {"xi-api-key": config.ELEVENLABS_API_KEY}
    if args.list_voices:
        list_voices(headers)
        return
    voice = args.voice or "river"
    voice_id = config.ELEVENLABS_VOICE_ID if voice == "river" else VOICES[voice]
    if not voice_id:
        sys.exit("Set ELEVENLABS_VOICE_ID in server/.env (see --list-voices)")
    folder = AUDIO_DIR if voice == "river" else AUDIO_DIR / voice

    made = skipped = 0
    with httpx.Client(headers=headers, timeout=60) as client:
        for key, texts in PHRASES.items():
            if voice != "river" and not (key.startswith("st_") or key in WALK_KEYS):
                continue
            for lang, text in texts.items():
                out = folder / lang / f"{key}.mp3"
                if out.exists() and not args.force:
                    skipped += 1
                    continue
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(synthesize(client, voice_id, text, lang))
                made += 1
                print(f"  {voice}/{lang}/{key}.mp3  {text}", flush=True)

    if voice == "river":
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps(PHRASES, ensure_ascii=False, indent=2) + "\n")
    print(f"Done ({voice}): {made} generated, {skipped} already existed.")


if __name__ == "__main__":
    main()
