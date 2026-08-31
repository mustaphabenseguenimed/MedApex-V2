import { useEffect, useRef, useState } from "react";

/**
 * Seconds elapsed since mount, counting only while the tab is visible and
 * the window focused — pauses while the user switches tabs/apps or
 * minimizes the window, so a "session timer" reflects actual engaged time
 * rather than wall-clock time.
 *
 * `enabled` also doubles as a manual pause switch: toggling it off freezes
 * the count without losing it, toggling it back on resumes from where it
 * left off. `initialSeconds` seeds the counter once, the first time it
 * becomes enabled — used to carry a previously-persisted duration forward
 * when resuming a session.
 */
export function useActiveElapsed(enabled = true, initialSeconds = 0) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const activeMsRef = useRef(initialSeconds * 1000);
  const segmentStartRef = useRef<number | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (!seededRef.current) {
      seededRef.current = true;
      activeMsRef.current = initialSeconds * 1000;
      setSeconds(initialSeconds);
    }
    const isActiveNow = () => document.visibilityState === "visible" && document.hasFocus();
    const pause = () => {
      if (segmentStartRef.current != null) {
        activeMsRef.current += Date.now() - segmentStartRef.current;
        segmentStartRef.current = null;
      }
    };
    const resume = () => {
      if (segmentStartRef.current == null && isActiveNow()) segmentStartRef.current = Date.now();
    };
    resume();
    const onVisibility = () => (isActiveNow() ? resume() : pause());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);
    const tick = setInterval(() => {
      const extra = segmentStartRef.current != null ? Date.now() - segmentStartRef.current : 0;
      setSeconds(Math.floor((activeMsRef.current + extra) / 1000));
    }, 1000);
    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", resume);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const getSeconds = () => {
    const extra = segmentStartRef.current != null ? Date.now() - segmentStartRef.current : 0;
    return Math.floor((activeMsRef.current + extra) / 1000);
  };

  return { seconds, getSeconds };
}
