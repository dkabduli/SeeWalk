import asyncio

from google import genai

import config
from lang_guard import in_language
from schemas import SceneResult

_client = genai.Client(api_key=config.GEMINI_API_KEY)
LANGUAGE = {"en": "English", "fr": "French"}

PROMPT = """Answer in {language}. You assist a blind pedestrian walking on a street. The camera is chest-height, facing forward.
The walking corridor is the ground straight ahead: from the bottom center of the frame out to where that path
vanishes, about a body's width plus a step to each side.
Report an obstacle only when its base (where it meets the ground) is in that corridor, so walking straight
would hit it. Stop signs and traffic lights are the exception: they stand at the curb or across the street,
never in the corridor, so report them wherever they are clearly visible and facing the walker.
Report things as soon as they are clearly visible:
- signs, crosswalks, traffic lights: up to ~15 m away (a stop sign 6 m / 20 ft away must always be reported).
- everything else: up to ~10 m away.
A door, pillar, chair, or pole you would miss by walking straight is beside the path. Leave it out of hazards.
It may be named in summary. Also leave out hydrants on the grass, parking or street-name signs, parked cars at
the curb, buildings, sky.
Distance: close = under 2 m, near = 2 to 6 m, far = 6 to 15 m.
Types:
- person: someone standing or walking in the corridor within ~6 m (close or near), or moving toward or across
  the walker's path. People off to the side, on another sidewalk, or farther away are left out. Urgency 2;
  urgency 1 if under 2 m or moving at the walker. Phrase only where they are ("Person ahead", "Person on your
  left"); never describe how anyone looks.
- bike / car: ONLY if moving toward or across the walker's path. A parked bike, bike rack or parked car
  that blocks the path is obstacle_in_path, never bike/car.
- door: a CLOSED door the corridor ends at (the walker would walk into a room or outside). A door in a wall
  alongside the path, on the left or the right, is not a door. A glass door under 2 m is urgency 1. If a glass
  entrance fills the view, always include it, even when a button post or bollard is closer. Never report that
  entrance as only obstacle_in_path. The post is pole if it is thin. Elevator doors are never a door.
- elevator: elevator doors, a call-button panel (up/down arrows), or a floor indicator the corridor leads to.
  Sliding metal doors indoors with a button beside them are an elevator, even when closed. Phrase "Elevator ahead".
  Never call these a door. An open shaft with no car is urgency 1. A room door with a handle is a door, not an elevator.
- door_open: that same door is open, so the walker can pass through. Phrase "Open door ahead".
- door_opening: the door is swinging into the path right now. Phrase "Door opening ahead". Urgency 1.
  A closed door and an open door are never both reported. Side doors are neither.
- pillar: a free-standing building column, wider than the walker's shoulders, whose base is in the corridor
  so walking straight would meet it. You must see open space on both sides of it. A wall, a doorway,
  a window frame, the edge of a building, a construction pylon, a bollard, a bike rack, a fence post,
  or a sign post is never a pillar. If you are not sure it is a column, leave it out. One column is enough.
- pole: a thin sign pole or lamp post whose base is on the walking surface in the corridor. A pole on the
  grass, at the curb, or holding a sign you are already reporting is not a pole. A lamp post on a base at
  the sidewalk edge, and a sign standing on grass, are beside the path. A blurry sign is not a pole.
- chair: a chair whose base is on the walking surface in the corridor. A chair against a wall or tucked at a
  table is not a chair hazard.
- obstacle_in_path: anything else standing in the corridor (bins, a bike rack). Not a door, pillar, pole, or chair.
  A fountain, sign, or other object sticking out from a wall into the corridor is obstacle_in_path, or
  head_height_obstacle if it would meet the head.
- head_height_obstacle: branches, signs, mirrors low enough to hit the head (below ~2 m). Tree canopies high
  overhead are not. stairs_down: real steps going DOWN in front of the walker. steps_up: one or more steps
  going UP (often in front of an entrance door). A seating edge, a ramp, or a hallway floor change is not
  stairs. If you report stairs, do not also report curb_or_dropoff for that same edge.
- Flat things flush with the ground (manhole covers, drains, painted lines) are never hazards.
- pothole: a hole or missing chunk of pavement in the path. uneven_surface: cracked, broken, heaved or raised
  pavement, a raised lip between slabs, gravel or a big puddle across the path: only if a foot could catch or
  trip on it. Normal joints between slabs and hairline cracks are NOT hazards.
- curb_or_dropoff: where the sidewalk ends at a street or drops down (curb edge, ramp edge, ledge).
- construction: cones, barriers, fences, construction signs or work zones on or across the sidewalk the walker
  is on (not cones out in the road).
- crosswalk: painted crossing lines on the road ahead. stop_sign: a red octagonal STOP / ARRET sign facing the
  walker, on either side of the street or across the intersection, even when small or partly hidden by a
  branch or a pole (a triangular yield sign is not a stop sign). Look for it in every frame: a clearly visible
  stop sign is never left out. traffic_light: a traffic or pedestrian signal ahead (never say its colour or whether to go).
  Report these three even if they are at the edge of the image, as long as they are clearly visible.
Urgency: 1 = immediate danger within ~2 m (a drop-off or stairs down, a pothole right in front, a head-height
obstacle, a closed glass door the walker is walking into, something moving at the walker). 2 = obstacle or surface problem in the path.
3 = information (crosswalk, stop sign, traffic light). A pole or a chair is urgency 2.
Never guess: if it isn't clearly visible, leave it out. At most 3 hazards, most important first; a clearly
visible stop sign is always one of the 3.
At night, use street lights, headlights, reflections and lit signs to see; a dark but readable street is not
unclear. Set unclear=true only if the path can't be seen at all (too blurry, black, or something covering the
lens, like a finger). Never say anything is safe to cross.
If a previous frame is given, use it only to judge whether things are approaching.
Also fill summary: the specific things in front that are not already a hazard, at most 12 words. Name them
(a water fountain, red couches, an elevator, an open doorway). A vague "hallway" is not enough. If elevator
doors are in front, the hazard type is elevator, not door, and the summary may name the call buttons. Empty if unclear.
The app speaks a real hazard first, then this summary. A person does not replace the summary.
LANGUAGE: write every phrase AND the summary in {language}, even though the examples here are in English.
Never call a path or sidewalk clear, free or safe, in any language (not "clear", "dégagé", "libre", "sûr").
Write each phrase in {language}, at most 4 words, naming the actual thing, then direction
(e.g. "Pothole ahead", "Broken pavement ahead", "Curb ahead", "Stop sign on your right", "Cones ahead",
"Door ahead", "Open door ahead", "Door opening ahead", "Elevator ahead", "Pillar ahead", "Chair ahead", "Pole on your right")."""

# Added only when the walker asked. The walk itself keeps the short prompt and the fast model.
CAREFUL_NOTE = (
    " The walker asked, so look once more. Sliding metal doors, a call button, up or down arrows, "
    "or a floor display are an elevator, never a door. Name the actual thing."
)


async def analyze_frame(
    image_b64: str, lang: str = "en", prev_image_b64: str | None = None, careful: bool = False,
) -> SceneResult:
    prompt = PROMPT.format(language=LANGUAGE[lang])
    if careful:
        prompt += CAREFUL_NOTE
    parts = [{"type": "text", "text": prompt}]
    if prev_image_b64:
        parts += [
            {"type": "text", "text": "Previous frame (about 1.5 s earlier):"},
            {"type": "image", "data": prev_image_b64, "mime_type": "image/jpeg"},
            {"type": "text", "text": "Current frame:"},
        ]
    parts.append({"type": "image", "data": image_b64, "mime_type": "image/jpeg"})

    interaction = await asyncio.wait_for(
        _client.aio.interactions.create(
            model=config.GEMINI_QUESTION_MODEL if careful else config.GEMINI_MODEL,
            input=parts,
            generation_config={
                "thinking_level": config.GEMINI_QUESTION_THINKING if careful else config.GEMINI_THINKING_LEVEL,
            },
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": SceneResult.model_json_schema(),
            },
        ),
        timeout=8 if careful else 4,
    )
    result = SceneResult.model_validate_json(interaction.output_text)
    # Never English in French mode, never "clear"/"dégagé"/"safe" (lang_guard.py)
    result.summary = await in_language(result.summary, lang)
    if lang == "fr":
        for h in result.hazards:
            h.phrase = await in_language(h.phrase, lang) or h.phrase
    return result
