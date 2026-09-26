import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { analyze } from "../api/client";
import type { Lang, SceneResult, SystemEvent } from "../api/types";
import { captureFrame, looksCovered } from "./captureFrame";
import { useCamera } from "./useCamera";

// `|| 1500` (not `?? 1500`) so an empty VITE_FRAME_INTERVAL_MS= can't become 0 and hammer Gemini
const INTERVAL_MS = Math.max(500, Number(import.meta.env.VITE_FRAME_INTERVAL_MS) || 1500);
const TIMEOUT_MS = 5000;
const NO_CONN_REPEAT_MS = 20000;
const PREV_MAX_AGE_MS = 4000; // older than this, the "previous frame" can't show motion honestly

/** What "What's ahead?" gets back. */
export type CheckResult =
  | { ok: true; result: SceneResult }
  | { ok: false; reason: "no_connection" | "camera_blocked" | "stopped" };

interface Options {
  lang: Lang;
  onResult: (result: SceneResult) => void;
  onSystem: (event: SystemEvent) => void;
}

export function useWalkLoop({ lang, onResult, onSystem }: Options) {
  // refs so the running loop always sees the latest props (updated after each render)
  const langRef = useRef(lang);
  const onResultRef = useRef(onResult);
  const onSystemRef = useRef(onSystem);
  useLayoutEffect(() => {
    langRef.current = lang;
    onResultRef.current = onResult;
    onSystemRef.current = onSystem;
  });

  const camera = useCamera(useCallback(() => onSystemRef.current("camera_blocked"), []));
  const generation = useRef(0); // bumps on every start/stop, so an old loop can never keep running
  const running = useRef(false);
  const prevFrame = useRef<{ b64: string; at: number } | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const cutWaitShort = useRef<(() => void) | null>(null);
  const askers = useRef<((r: CheckResult) => void)[]>([]);
  const resetFailures = useRef(false);

  const keepAwake = useCallback(async () => {
    try { wakeLock.current = await navigator.wakeLock?.request("screen"); } catch { /* refused: fine */ }
  }, []);

  // iOS drops the wake lock (and sometimes the camera) when the page is hidden. When the walker
  // comes back to Safari, take both back, and forget failures that happened while frozen.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || !running.current) return;
      resetFailures.current = true;
      await keepAwake();
      if (!camera.isLive()) {
        try { await camera.start(); } catch { onSystemRef.current("camera_blocked"); }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [camera, keepAwake]);

  /** "What's ahead?": answer with the snapshot in flight, or take one right away. */
  const checkNow = useCallback(
    () =>
      new Promise<CheckResult>((resolve) => {
        if (!running.current) return resolve({ ok: false, reason: "stopped" });
        askers.current.push(resolve);
        cutWaitShort.current?.();
      }),
    [],
  );

  const start = useCallback(async () => {
    const gen = ++generation.current;
    const alive = () => running.current && generation.current === gen;
    running.current = true;
    prevFrame.current = null;

    try {
      await camera.start();
    } catch {
      // Permission denied or no camera. Never fail silently.
      if (generation.current === gen) {
        running.current = false;
        onSystemRef.current("camera_blocked");
      }
      return;
    }
    if (!alive()) { camera.stop(); return; } // Stop was tapped during the permission prompt
    await keepAwake();

    let fails = 0;
    let lastNoConn = 0;
    let blockedCount = 0;

    while (alive()) {
      const roundStart = performance.now();
      if (resetFailures.current) { fails = 0; resetFailures.current = false; }
      const video = camera.videoRef.current;
      const frame = video && camera.isLive() ? captureFrame(video) : null;
      const blocked = !camera.isLive() || (frame !== null && looksCovered(frame));
      blockedCount = blocked ? blockedCount + 1 : 0;
      if (blockedCount === 2) onSystemRef.current("camera_blocked");

      if (frame && !blocked) {
        const prev = prevFrame.current && frame.at - prevFrame.current.at < PREV_MAX_AGE_MS
          ? prevFrame.current.b64
          : null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        let answer: CheckResult;
        try {
          const result = await analyze(frame.b64, prev, langRef.current, ctrl.signal);
          if (!alive()) break; // stopped while we were waiting: drop it
          if (fails >= 2) onSystemRef.current("connection_back");
          fails = 0;
          answer = { ok: true, result };
          // Anyone who asked while this was in flight gets THIS result (fastest answer) and
          // speaks it themselves, so the loop doesn't speak it too
          if (askers.current.length === 0) onResultRef.current(result);
        } catch {
          if (!alive()) break;
          fails += 1;
          answer = { ok: false, reason: "no_connection" };
          const now = Date.now();
          if (fails === 2 || (fails > 2 && now - lastNoConn > NO_CONN_REPEAT_MS)) {
            onSystemRef.current("no_connection");
            lastNoConn = now;
          }
        } finally {
          clearTimeout(timer);
        }
        prevFrame.current = { b64: frame.b64, at: frame.at };
        askers.current.splice(0).forEach((resolve) => resolve(answer));
      } else if (blocked) {
        askers.current.splice(0).forEach((resolve) => resolve({ ok: false, reason: "camera_blocked" }));
      }
      // (no frame yet because the camera is still warming up: askers wait for the next round)

      // Wait out the interval, unless "What's ahead?" cuts it short
      const wait = INTERVAL_MS - (performance.now() - roundStart);
      if (wait > 0 && askers.current.length === 0 && alive()) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, wait);
          cutWaitShort.current = () => { clearTimeout(t); resolve(); };
        });
      } else if (askers.current.length > 0 && !frame && !blocked) {
        await new Promise((r) => setTimeout(r, 200)); // camera warming up: don't spin
      }
      cutWaitShort.current = null;
    }
    if (generation.current === gen) {
      askers.current.splice(0).forEach((resolve) => resolve({ ok: false, reason: "stopped" }));
    }
  }, [camera, keepAwake]);

  const stop = useCallback(() => {
    running.current = false;
    generation.current++;
    cutWaitShort.current?.();
    askers.current.splice(0).forEach((resolve) => resolve({ ok: false, reason: "stopped" }));
    camera.stop();
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, [camera]);

  return useMemo(
    () => ({ videoRef: camera.videoRef, start, stop, checkNow }),
    [camera.videoRef, start, stop, checkNow],
  );
}
