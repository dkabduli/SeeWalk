import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { sendToLaptop } from "../debug/laptopLog";
import { mainBackCamera, nextLight, QUALITY, tuning, type Light } from "./lens";

let mainLens: string | null = null; // remembered for this visit, so later starts open it directly

/** Continuous focus / exposure / white balance and no digital zoom, where supported; and a line in
 *  the laptop log saying what the phone actually gave us. */
async function steady(track: MediaStreamTrack | undefined) {
  if (!track) return;
  let applied: Record<string, unknown> = {};
  try {
    const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    applied = tuning(caps);
    if (Object.keys(applied).length) await track.applyConstraints({ advanced: [applied as MediaTrackConstraintSet] });
  } catch { applied = {}; /* the picture still works without it */ }
  const s = track.getSettings();
  sendToLaptop({
    at: new Date().toLocaleTimeString([], { hour12: false }), kind: "camera",
    text: `${track.label || "camera"} ${s.width}x${s.height} ${s.frameRate ?? "?"} fps; tuned: ${JSON.stringify(applied)}`,
  });
}

export function useCamera(onEnded: () => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // The flashlight, on iPhones where Safari offers it (it lists "torch" in the camera's capabilities)
  const light = useRef<Light>({ on: false, dark: 0 });
  const onEndedRef = useRef(onEnded);
  useLayoutEffect(() => { onEndedRef.current = onEnded; });

  const stop = useCallback(() => {
    light.current = { on: false, dark: 0 };                  // stopping the track turns the light off
    streamRef.current?.getTracks().forEach((t) => t.stop()); // page-initiated stop never fires "ended"
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    stop(); // never leak an old stream (e.g. when restarting after the page was hidden)
    const open = (video: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video, audio: false });
    // The main rear lens if we know it (from an earlier start), else "rear" and look it up below.
    // iOS gives a portrait stream when the phone is held upright.
    let stream = await open(mainLens ? { deviceId: { exact: mainLens }, ...QUALITY } : { facingMode: { ideal: "environment" }, ...QUALITY })
      .catch(() => open({ facingMode: { ideal: "environment" }, ...QUALITY })); // a stale id: ask for any rear one
    // Lens names are only readable once the camera is allowed, so check after the first open. If iOS
    // picked a lens-switching virtual camera, reopen on the main lens so the picture never jumps.
    try {
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      const main = mainBackCamera(cameras);
      if (main && main !== stream.getVideoTracks()[0]?.getSettings().deviceId) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await open({ deviceId: { exact: main }, ...QUALITY });
      }
      if (main) mainLens = main;
    } catch { /* keep the stream we have */ }
    const track = stream.getVideoTracks()[0];
    await steady(track);
    streamRef.current = stream;
    track.addEventListener("ended", () => onEndedRef.current());
    const video = videoRef.current;
    if (!video) throw new Error("video element not mounted");
    video.srcObject = stream;
    await video.play();
  }, [stop]);

  const adjustLight = useCallback((brightness: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || light.current.on) return;
    const next = nextLight(light.current, brightness);
    light.current = next;
    if (!next.on) return;
    const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    const at = new Date().toLocaleTimeString([], { hour12: false });
    if (!caps.torch) {
      sendToLaptop({ at, kind: "camera", text: `dark (brightness ${Math.round(brightness)}); no flashlight on this phone` });
      return;
    }
    track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
      .then(() => sendToLaptop({ at, kind: "camera", text: `dark (brightness ${Math.round(brightness)}): flashlight on` }))
      .catch((e: Error) => sendToLaptop({ at, kind: "camera", text: `flashlight failed: ${e.name}` }));
  }, []);

  /** True while the camera is actually delivering frames. iOS "mutes" the track during
   *  interruptions (a call, Siri, the page being hidden) and unmutes it afterwards. */
  const isLive = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    return !!track && track.readyState === "live" && !track.muted;
  }, []);

  return useMemo(() => ({ videoRef, start, stop, isLive, adjustLight }), [start, stop, isLive, adjustLight]);
}
