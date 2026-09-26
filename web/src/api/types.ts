export type Lang = "en" | "fr";

export type HazardType =
  | "person" | "bike" | "car" | "crosswalk" | "stop_sign" | "pothole" | "uneven_surface"
  | "head_height_obstacle" | "obstacle_in_path" | "construction" | "curb_or_dropoff"
  | "stairs_down" | "other";

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
}

export type SystemEvent = "no_connection" | "connection_back" | "camera_blocked";
