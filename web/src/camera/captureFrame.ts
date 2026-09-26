const frameCanvas = document.createElement("canvas");
const tinyCanvas = document.createElement("canvas");
tinyCanvas.width = tinyCanvas.height = 32;

export interface Frame {
  b64: string;       // JPEG, no "data:" prefix
  brightness: number; // average, 0 (black) – 255 (white)
  contrast: number;   // standard deviation of brightness; near 0 = flat, featureless image
  at: number;         // Date.now() when captured
}

export function captureFrame(video: HTMLVideoElement, maxEdge = 768): Frame | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null; // camera not ready yet

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  frameCanvas.width = Math.round(w * scale);   // portrait phone → 576 × 768
  frameCanvas.height = Math.round(h * scale);
  frameCanvas.getContext("2d")!.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
  const b64 = frameCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];

  const tiny = tinyCanvas.getContext("2d", { willReadFrequently: true })!;
  tiny.drawImage(video, 0, 0, 32, 32);
  const px = tiny.getImageData(0, 0, 32, 32).data;
  const lum: number[] = [];
  for (let i = 0; i < px.length; i += 4) lum.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  const brightness = lum.reduce((a, b) => a + b, 0) / lum.length;
  const contrast = Math.sqrt(lum.reduce((a, b) => a + (b - brightness) ** 2, 0) / lum.length);
  return { b64, brightness, contrast, at: Date.now() };
}

/** A finger over the lens isn't black: auto-exposure turns it into a flat, dim, reddish blur.
 *  So "covered" = very dark, OR flat and dim. A bright blank wall stays "not covered".
 *  Measured on Abdul's iPhone (Sept 26): finger = brightness 28–56, contrast 6–10;
 *  normal scenes = contrast 24+; bright blank wall/window = brightness 250+, contrast 1–7. */
export const looksCovered = (f: Frame) => f.brightness < 12 || (f.contrast < 12 && f.brightness < 90);
