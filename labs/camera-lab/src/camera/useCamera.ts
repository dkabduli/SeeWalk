import { useCallback, useMemo, useRef } from "react";

export function useCamera(onEnded: () => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onEndedRef = useRef(onEnded); onEndedRef.current = onEnded;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop()); // page-initiated stop never fires "ended"
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    stop(); // never leak an old stream (e.g. when restarting after the page was hidden)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }, // rear camera; iOS gives a portrait stream when held upright
      audio: false,
    });
    streamRef.current = stream;
    stream.getVideoTracks()[0].addEventListener("ended", () => onEndedRef.current());
    const video = videoRef.current;
    if (!video) throw new Error("video element not mounted");
    video.srcObject = stream;
    await video.play();
  }, [stop]);

  /** True while the camera is actually delivering frames. iOS "mutes" the track during
   *  interruptions (a call, Siri, the page being hidden) and unmutes it afterwards. */
  const isLive = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    return !!track && track.readyState === "live" && !track.muted;
  }, []);

  return useMemo(() => ({ videoRef, start, stop, isLive }), [start, stop, isLive]);
}
