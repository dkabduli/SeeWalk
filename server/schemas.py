from typing import Literal, Optional

from pydantic import BaseModel, Field

HazardType = Literal[
    "person", "bike", "car", "crosswalk", "stop_sign", "pothole", "uneven_surface",
    "head_height_obstacle", "obstacle_in_path", "construction", "curb_or_dropoff",
    "stairs_down", "steps_up", "traffic_light", "door", "door_open", "door_opening", "elevator", "pillar", "pole", "chair", "other",
]


class Hazard(BaseModel):
    type: HazardType
    direction: Literal["left", "ahead", "right"]
    distance: Literal["close", "near", "far"] = Field(description="close = under 2 m, near = 2-6 m, far = 6-15 m")
    urgency: int = Field(ge=1, le=3, description="1 = immediate danger within ~2 m, 2 = obstacle or surface problem in the path, 3 = information")
    confidence: float = Field(ge=0, le=1)
    approaching: bool = Field(description="True if it is moving toward the walker between the two frames")
    phrase: str = Field(description="At most 4 words, hazard then direction, in the requested language")


class SceneResult(BaseModel):
    hazards: list[Hazard]
    unclear: bool = Field(description="True if the image is too blurry or dark to judge")
    summary: str = Field(
        description="What else is in front that is not already listed as a hazard, in the requested language, in at most 8 words "
        "(e.g. 'Chairs along the wall'). The app speaks the hazards first, then this. Empty if the hazards "
        "already cover the scene, or if unclear."
    )


class AnalyzeRequest(BaseModel):
    image: str
    prev_image: Optional[str] = None
    lang: Literal["en", "fr"] = "en"
    careful: bool = False


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=400)  # "read this" answers can be ~25 words
    lang: Literal["en", "fr"] = "en"
    voice: Literal["river", "alice", "charlie", "moyo"] = "river"
