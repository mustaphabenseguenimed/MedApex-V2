import { useEffect, useRef, useState } from "react";

/**
 * Seconds elapsed since mount, counting only while the tab is visible and
 * the window focused — pauses while the user switches tabs/apps or
 * minimizes the window, so a "session timer" reflects actual engaged time
 * rather than wall-clock time.
 */
export function useActiveElapsed(enabled = true) {
  const [seconds, setSeconds] = useState(0);
  const activeMsRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  const getSeconds = () => {
    const extra = segmentStartRef.current != null ? Date.now() - segmentStartRef.current : 0;
    return Math.floor((activeMsRef.current + extra) / 1000);
  };

  return { seconds, getSeconds };
}
