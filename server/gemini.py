import asyncio

from google import genai

import config
from schemas import SceneResult

_client = genai.Client(api_key=config.GEMINI_API_KEY)
LANGUAGE = {"en": "English", "fr": "French"}

PROMPT = """You assist a blind pedestrian walking on a quiet street. The camera is chest-height, facing forward.
Report ONLY things that matter for walking safely in the next ~10 metres, IN THE WALKING PATH (the sidewalk or
floor straight ahead, roughly the middle of the image). Leave out anything beside the path (hydrants or poles on
the grass, parking or street-name signs, parked cars at the curb), buildings, sky.
Types:
- person / bike / car: ONLY if moving toward or across the walker's path. A parked bike, bike rack or parked car
  that blocks the path is obstacle_in_path, never bike/car.
- obstacle_in_path: anything standing in the path (bins, posts, chairs, closed doors including glass doors).
- head_height_obstacle: branches, signs, mirrors at head height. curb_or_dropoff, stairs_down: edges and steps down.
- pothole: a hole or missing chunk of pavement in the path. uneven_surface: cracked, broken, heaved or raised
  pavement, a raised lip between slabs, gravel or a big puddle across the path: only if a foot could catch or
  trip on it. Normal joints between slabs and hairline cracks are NOT hazards.
- curb_or_dropoff: where the sidewalk ends at a street or drops down (curb edge, ramp edge, ledge).
- construction: cones, barriers, fences, construction signs or work zones on or across the path.
- crosswalk: painted crossing lines on the road ahead. stop_sign: a red octagonal STOP / ARRET sign facing the
  walker. traffic_light: a traffic or pedestrian signal ahead (never say its colour or whether to go).
  Report these three even if they are at the edge of the image, as long as they are clearly visible.
Urgency: 1 = immediate danger within ~2 m (a drop-off or stairs down, a pothole right in front, a head-height
obstacle, something moving at the walker). 2 = obstacle or surface problem in the path.
3 = information (crosswalk, stop sign, traffic light).
Never guess: if it isn't clearly visible, leave it out. At most 3 hazards, most important first.
If the image is too blurry or dark, set unclear=true. Never say anything is safe to cross.
If a previous frame is given, use it only to judge whether things are approaching.
Also fill summary: the main things in front of the camera in at most 6 words, hazard or not (e.g. "Laptop and
lotion on a table", "Empty hallway", "Street with parked cars"). Plain nouns, no guessing; empty if unclear.
Write each phrase in {language}, at most 4 words, naming the actual thing, then direction
(e.g. "Pothole ahead", "Broken pavement ahead", "Curb ahead", "Stop sign on your right", "Cones ahead",
"Bins ahead", "Glass door ahead")."""


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
