from typing import Literal, Optional

from pydantic import BaseModel, Field

HazardType = Literal[
    "person", "bike", "car", "crosswalk", "stop_sign", "pothole", "uneven_surface",
    "head_height_obstacle", "obstacle_in_path", "construction", "curb_or_dropoff",
    "stairs_down", "other",
]


class Hazard(BaseModel):
    type: HazardType
    direction: Literal["left", "ahead", "right"]
    distance: Literal["close", "near", "far"]
    urgency: int = Field(ge=1, le=3, description="1 = immediate danger within ~2 m, 2 = obstacle or surface problem in the path, 3 = information")
    confidence: float = Field(ge=0, le=1)
    approaching: bool = Field(description="True if it is moving toward the walker between the two frames")
    phrase: str = Field(description="At most 4 words, hazard then direction, in the requested language")


class SceneResult(BaseModel):
    hazards: list[Hazard]
    unclear: bool = Field(description="True if the image is too blurry or dark to judge")
    summary: str = Field(
        description="What is in front of the camera, hazard or not, in at most 6 words in the requested "
        "language (e.g. 'Laptop and a bottle on a table'). Only spoken when the walker asks 'What's ahead?'. "
        "Empty if unclear."
    )


class AnalyzeRequest(BaseModel):
    image: str
    prev_image: Optional[str] = None
    lang: Literal["en", "fr"] = "en"


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=400)  # "read this" answers can be ~25 words
    lang: Literal["en", "fr"] = "en"
