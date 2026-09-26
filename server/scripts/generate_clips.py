"""Generate the bundled ElevenLabs clip library (EN + FR) into web/public/audio/.

  python server/scripts/generate_clips.py                # generate missing clips
  python server/scripts/generate_clips.py --force        # regenerate everything
  python server/scripts/generate_clips.py --list-voices  # print available voices
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config  # noqa: E402

import httpx  # noqa: E402

from phrases import PHRASES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
AUDIO_DIR = ROOT / "web" / "public" / "audio"
MANIFEST = ROOT / "web" / "src" / "audio" / "clips.json"
API = "https://api.elevenlabs.io/v1"
MODEL_ID = "eleven_multilingual_v2"


def list_voices(headers: dict) -> None:
    voices = httpx.get(f"{API}/voices", headers=headers, timeout=15).json()["voices"]
    for v in voices:
        labels = v.get("labels", {})
        print(f'{v["voice_id"]}  {v["name"]:<40} {labels.get("gender", ""):<8} {labels.get("accent", "")}')


def synthesize(client: httpx.Client, text: str, lang: str) -> bytes:
    r = client.post(
        f"{API}/text-to-speech/{config.ELEVENLABS_VOICE_ID}",
        params={"output_format": "mp3_44100_128"},
        json={
            "text": text,
            "model_id": MODEL_ID,
            "language_code": lang,
            "voice_settings": {"stability": 0.6, "similarity_boost": 0.75},
        },
    )
    r.raise_for_status()
    return r.content


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-voices", action="store_true")
    parser.add_argument("--force", action="store_true", help="regenerate clips that already exist")
    args = parser.parse_args()

    headers = {"xi-api-key": config.ELEVENLABS_API_KEY}
    if args.list_voices:
        list_voices(headers)
        return
    if not config.ELEVENLABS_VOICE_ID:
        sys.exit("Set ELEVENLABS_VOICE_ID in server/.env (see --list-voices)")

    made = skipped = 0
    with httpx.Client(headers=headers, timeout=60) as client:
        for key, texts in PHRASES.items():
            for lang, text in texts.items():
                out = AUDIO_DIR / lang / f"{key}.mp3"
                if out.exists() and not args.force:
                    skipped += 1
                    continue
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(synthesize(client, text, lang))
                made += 1
                print(f"  {lang}/{key}.mp3  {text}")

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(PHRASES, ensure_ascii=False, indent=2) + "\n")
    print(f"Done: {made} generated, {skipped} already existed. Manifest: {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
