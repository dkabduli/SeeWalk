import asyncio

from google import genai

import config
from schemas import SceneResult

_client = genai.Client(api_key=config.GEMINI_API_KEY)
LANGUAGE = {"en": "English", "fr": "French"}

PROMPT = """You assist a blind pedestrian walking on a quiet street. The camera is chest-height, facing forward.
Report ONLY things that matter for walking safely in the next ~10 metres, IN THE WALKING PATH (the sidewalk or
floor straight ahead, roughly the middle of the image). Leave out anything beside the path (hydrants or poles on
the grass, signs at the edge, parked cars at the curb), buildings, sky.
Types:
- person / bike / car: ONLY if moving toward or across the walker's path. A parked bike, bike rack or parked car
  that blocks the path is obstacle_in_path, never bike/car.
- obstacle_in_path: anything standing in the path (bins, posts, chairs, closed doors including glass doors).
- head_height_obstacle: branches, signs, mirrors at head height. curb_or_dropoff, stairs_down: edges and steps down.
- crosswalk, stop_sign: only if clearly visible ahead. pothole, uneven_surface, construction.
Urgency: 1 = immediate danger within ~2 m (a drop-off or stairs down, a head-height obstacle, something moving at
the walker). 2 = obstacle or surface problem in the path. 3 = information (crosswalk, stop sign).
Never guess: if it isn't clearly visible, leave it out. At most 3 hazards, most important first.
If the image is too blurry or dark, set unclear=true. Never say anything is safe to cross.
If a previous frame is given, use it only to judge whether things are approaching.
Also fill summary: the main things in front of the camera in at most 6 words, hazard or not (e.g. "Laptop and
lotion on a table", "Empty hallway", "Street with parked cars"). Plain nouns, no guessing; empty if unclear.
Write each phrase in {language}, at most 4 words, naming the actual thing, then direction
(e.g. "Bins ahead", "Glass door ahead", "Parked bike ahead", "Person on your left")."""


async def analyze_frame(image_b64: str, lang: str = "en", prev_image_b64: str | None = None) -> SceneResult:
    parts = [{"type": "text", "text": PROMPT.format(language=LANGUAGE[lang])}]
    if prev_image_b64:
        parts += [
            {"type": "text", "text": "Previous frame (about 1.5 s earlier):"},
            {"type": "image", "data": prev_image_b64, "mime_type": "image/jpeg"},
            {"type": "text", "text": "Current frame:"},
        ]
    parts.append({"type": "image", "data": image_b64, "mime_type": "image/jpeg"})

    interaction = await asyncio.wait_for(
        _client.aio.interactions.create(
            model=config.GEMINI_MODEL,
            input=parts,
            generation_config={"thinking_level": config.GEMINI_THINKING_LEVEL},
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": SceneResult.model_json_schema(),
            },
        ),
        timeout=4,
    )
    return SceneResult.model_validate_json(interaction.output_text)
