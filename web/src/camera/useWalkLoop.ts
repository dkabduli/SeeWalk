import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { analyze } from "../api/client";
import type { Lang, SceneResult, SystemEvent } from "../api/types";
import { captureFrame, looksCovered, sceneChanged } from "./captureFrame";
import { useCamera } from "./useCamera";

// A new snapshot every 0.8 s, up to 2 at Gemini at once (each answer takes ~1.6 s), so the walker
// hears about a door or a stop sign ~1 s sooner than with one at a time.
// `|| 800` (not `?? 800`) so an empty VITE_FRAME_INTERVAL_MS= can't become 0 and hammer Gemini
const INTERVAL_MS = Math.max(500, Number(import.meta.env.VITE_FRAME_INTERVAL_MS) || 800);
const MAX_IN_FLIGHT = 2;
// A picture that has not changed is not sent again. A slow creep still gets a look on this timer.
const SAME_HOLD_MS = 2400;
const TIMEOUT_MS = 5000;
const NO_CONN_REPEAT_MS = 20000;

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
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const cutWaitShort = useRef<(() => void) | null>(null);
  const inFlight = useRef(0);
  const askers = useRef<{ resolve: (r: CheckResult) => void; careful: boolean }[]>([]);
  // One look started when speech begins, so "what's ahead" does not wait for speech and then a photo.
  const primed = useRef<Promise<CheckResult> | null>(null);
  const resetFailures = useRef(false);
  // Paused while SeeWalk is answering a question: no background snapshots go to Gemini, so the
  // answer isn't competing with them. "What's ahead?" (checkNow) still works while paused.
  const paused = useRef(false);
  const setPaused = useCallback((on: boolean) => { paused.current = on; }, []);

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

  /** A question passes careful=true so it is not answered by the fast photo already in flight. */
  const checkNow = useCallback(
    (careful = false) =>
      new Promise<CheckResult>((resolve) => {
        if (!running.current) return resolve({ ok: false, reason: "stopped" });
        askers.current.push({ resolve, careful });
        if (inFlight.current === 0 || careful) cutWaitShort.current?.();

      }),
    [],
  );

  /** Start a careful look as soon as someone speaks, before the server has heard the words. */
  const primeLook = useCallback(() => {
    if (!running.current || primed.current) return;
    primed.current = checkNow(true);
  }, [checkNow]);

  /** The careful look started when speech began, or a new careful one if none was started. */
  const takeLook = useCallback(() => {
    const pending = primed.current;
    primed.current = null;
    return pending ?? checkNow(true);
  }, [checkNow]);

  /** Speech was not a scene question. Say the photo as a normal alert, once. */
  const releaseLook = useCallback(() => {
    const pending = primed.current;
    if (!pending) return;
    primed.current = null;
    void pending.then((r) => {
      if (r.ok) onResultRef.current(r.result);
    });
  }, []);

  /** Speech was a different question. Drop the extra photo so it is not spoken over the answer. */
  const dropLook = useCallback(() => {
    primed.current = null;
  }, []);

  const start = useCallback(async () => {
    const gen = ++generation.current;
    const alive = () => running.current && generation.current === gen;
    running.current = true;

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
    // Requests of THIS loop at Gemini. A stopped loop's late answers must not touch a new loop's
    // count, so it's local and mirrored into inFlight (read by checkNow) only while current.
    let flying = 0;
    let carefulFlying = 0;
    const setFlying = (n: number) => { flying = n; if (generation.current === gen) inFlight.current = n; };
    setFlying(0);
    let sent = 0;            // numbers each snapshot in the order it was taken
    let newestSpoken = 0;    // an answer older than one already handled is dropped
    let lastSample: Uint8ClampedArray | null = null;
    let lastSentAt = 0;

    // One snapshot → Gemini. Up to MAX_IN_FLIGHT of these overlap, so a fresh look at the path
    // arrives every ~0.8 s even though each answer takes ~1.6 s.
    const takeAskers = (careful: boolean) => {
      const mine = askers.current.filter((a) => a.careful === careful);
      askers.current = askers.current.filter((a) => a.careful !== careful);
      return mine;
    };

    const send = async (b64: string, careful: boolean) => {
      const seq = ++sent;
      setFlying(flying + 1);
      if (careful) carefulFlying += 1;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), careful ? 8000 : TIMEOUT_MS);
      try {
        const sentLang = langRef.current;
        const result = await analyze(b64, null, sentLang, ctrl.signal, careful);
        if (!alive()) return; // stopped while we were waiting: drop it
        if (fails >= 2) onSystemRef.current("connection_back");
        fails = 0;
        const waiting = takeAskers(careful);
        // A fast photo can become a street alert. A question photo is spoken by the asker.
        // Sent before a language switch: it's in the old language, so it isn't spoken
        if (!careful && seq > newestSpoken && langRef.current === sentLang) {
          newestSpoken = seq;
          if (waiting.length === 0) onResultRef.current(result);
        }
        waiting.forEach((a) => a.resolve({ ok: true, result }));
      } catch {
        if (!alive()) return;
        fails += 1;
        const now = Date.now();
        if (fails === 2 || (fails > 2 && now - lastNoConn > NO_CONN_REPEAT_MS)) {
          onSystemRef.current("no_connection");
          lastNoConn = now;
        }
        // Someone asked: tell them, unless another snapshot of the same kind is still on its way
        if (careful || flying === 1) takeAskers(careful).forEach((a) => a.resolve({ ok: false, reason: "no_connection" }));
      } finally {
        clearTimeout(timer);
        if (careful) carefulFlying -= 1;
        setFlying(flying - 1);
      }
    };

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        cutWaitShort.current = () => { clearTimeout(t); resolve(); };
      }).finally(() => { cutWaitShort.current = null; });

    while (alive()) {
      const roundStart = performance.now();
      if (resetFailures.current) { fails = 0; resetFailures.current = false; }
      const asked = askers.current.length > 0;
      const wantsCareful = askers.current.some((a) => a.careful);
      if (paused.current && !asked) { await sleep(250); continue; }
      // Full: wait. A fast photo in flight does not answer a question, so a careful one can still go.
      if (flying >= MAX_IN_FLIGHT || (wantsCareful && carefulFlying > 0) || (asked && !wantsCareful && flying > 0)) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      const video = camera.videoRef.current;
      const frame = video && camera.isLive() ? captureFrame(video) : null;
      const blocked = !camera.isLive() || (frame !== null && looksCovered(frame));
      blockedCount = blocked ? blockedCount + 1 : 0;
      if (blockedCount === 2) onSystemRef.current("camera_blocked");

      if (blocked) lastSample = null;
      const sameScene = !!frame?.sample && !!lastSample && !sceneChanged(lastSample, frame.sample) && performance.now() - lastSentAt < SAME_HOLD_MS;
      if (frame && !blocked && (asked || !sameScene)) {
        if (frame.sample) lastSample = frame.sample;
        lastSentAt = performance.now();
        void send(frame.b64, wantsCareful);
      } else if (blocked) {
        askers.current.splice(0).forEach((a) => a.resolve({ ok: false, reason: "camera_blocked" }));
      } else if (asked) {
        await new Promise((r) => setTimeout(r, 200)); // camera warming up: don't spin
        continue;
      }
      // Wait out the interval; "What's ahead?" cuts it short
      const wait = INTERVAL_MS - (performance.now() - roundStart);
      if (wait > 0 && alive()) await sleep(wait);
    }
    if (generation.current === gen) {
      askers.current.splice(0).forEach((a) => a.resolve({ ok: false, reason: "stopped" }));
    }
  }, [camera, keepAwake]);

  const stop = useCallback(() => {
    running.current = false;
    generation.current++;
    inFlight.current = 0;
    primed.current = null;
    cutWaitShort.current?.();
    askers.current.splice(0).forEach((a) => a.resolve({ ok: false, reason: "stopped" }));
    camera.stop();
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, [camera]);

  return useMemo(
    () => ({ videoRef: camera.videoRef, start, stop, checkNow, primeLook, takeLook, releaseLook, dropLook, setPaused }),
    [camera.videoRef, start, stop, checkNow, primeLook, takeLook, releaseLook, dropLook, setPaused],
  );
}
