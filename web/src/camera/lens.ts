/** Which rear camera to use, and how to set it up for a steady, sharp picture.
 *
 *  iPhones with two or three rear lenses offer "virtual" cameras ("Back Dual Wide Camera", "Back
 *  Triple Camera") that switch lenses on their own: when something gets close, the picture jumps to
 *  the ultra-wide lens, which looks like the camera zooming in and out. The plain "Back Camera" (the
 *  main wide lens) never switches. Labels follow the phone's language, so French names count too. */

const BACK = /\b(back|rear)\b|arrière/i;
const NOT_MAIN = /dual|triple|ultra|wide|tele|double|grand[- ]angle|téléobjectif/i;

export interface CameraInfo { deviceId: string; label: string }

/** The main rear lens, or null if the phone doesn't name one (then keep what iOS picked). */
export function mainBackCamera(cameras: CameraInfo[]): string | null {
  const back = cameras.filter((c) => c.deviceId && BACK.test(c.label));
  const main = back.find((c) => !NOT_MAIN.test(c.label));
  return main?.deviceId ?? null;
}

/** 1080p at 30 fps: ~6x the detail of the 640x480 iOS gives when nothing is asked for.
 *  (iOS rotates it to 1080x1920 when the phone is upright.) */
export const QUALITY: MediaTrackConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30 },
};

type Caps = Record<string, unknown>;

/** Continuous autofocus / exposure / white balance and no digital zoom, where the phone supports
 *  them (it lists them in the track's capabilities). Unsupported ones are left alone. */
export function tuning(caps: Caps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["focusMode", "exposureMode", "whiteBalanceMode"]) {
    const modes = caps[key];
    if (Array.isArray(modes) && modes.includes("continuous")) out[key] = "continuous";
  }
  const zoom = caps.zoom as { min?: number; max?: number } | undefined;
  if (zoom && typeof zoom.min === "number") out.zoom = Math.max(1, zoom.min);
  return out;
}
