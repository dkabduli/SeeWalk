export type Lang = "en" | "fr";

export type HazardType =
  | "person" | "bike" | "car" | "crosswalk" | "stop_sign" | "pothole" | "uneven_surface"
  | "head_height_obstacle" | "obstacle_in_path" | "construction" | "curb_or_dropoff"
  | "stairs_down" | "steps_up" | "traffic_light" | "door" | "door_open" | "door_opening" | "elevator" | "pillar" | "pole" | "chair" | "other";

export interface Hazard {
  type: HazardType;
  direction: "left" | "ahead" | "right";
  distance: "close" | "near" | "far";
  urgency: 1 | 2 | 3;
  confidence: number;
  approaching: boolean;
  phrase: string;
}

export interface SceneResult {
  hazards: Hazard[];
  unclear: boolean;
  /** The rest of the scene, after the hazards ("Chairs along the wall"). Spoken after them when
   *  the walker asks "What's ahead?". */
  summary?: string;
}

export type SystemEvent = "no_connection" | "connection_back" | "camera_blocked";

/** Voice commands ("SeeWalk, …"). whats_ahead, path, and cross are answered by the app itself. */
export type VoiceIntent = "none" | "whats_ahead" | "holding" | "path" | "read" | "cross" | "where" | "around";

/** POST /listen: what the mic heard, which command it was, and Gemini's answer from the frame. */
export interface ListenResult {
  heard: string;
  intent: VoiceIntent;
  answer: string;   // for holding / read; "" otherwise
  command: boolean; // intent !== "none"
}
