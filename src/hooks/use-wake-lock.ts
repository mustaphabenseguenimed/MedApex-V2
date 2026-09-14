import { useCallback, useEffect, useRef } from "react";

type WakeLockSentinel = { release: () => Promise<void>; released: boolean };
type WakeLockNavigator = { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> } };

/**
 * Keep the screen on while a long conversion runs.
 *
 * A step 1 run takes minutes, and a phone whose screen sleeps meanwhile gets
 * its page suspended: requests in flight die and come back as "connexion
 * instable", with every page already converted thrown away. Holding a screen
 * wake lock for the duration is what keeps that from happening.
 *
 * Entirely best-effort — the API is missing in some browsers and the request
 * can be refused (low battery, no user gesture). Either way the conversion
 * runs exactly as before, so nothing here ever surfaces an error.
 */
export function useScreenWakeLock() {
  const sentinel = useRef<WakeLockSentinel | null>(null);
  const wanted = useRef(false);

  const request = useCallback(async () => {
    const api = (navigator as unknown as WakeLockNavigator).wakeLock;
    if (!api || sentinel.current) return;
    try {
      sentinel.current = await api.request("screen");
    } catch {
      sentinel.current = null;
    }
  }, []);

  const acquire = useCallback(() => {
    wanted.current = true;
    void request();
  }, [request]);

  const release = useCallback(() => {
    wanted.current = false;
    const held = sentinel.current;
    sentinel.current = null;
    void held?.release().catch(() => {});
  }, []);

  // The browser drops the lock whenever the tab is hidden — switching apps
  // mid-run and coming back must not leave the screen free to sleep again.
  useEffect(() => {
    const onVisible = () => {
      if (wanted.current && document.visibilityState === "visible") {
        sentinel.current = null;
        void request();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel.current?.release().catch(() => {});
      sentinel.current = null;
    };
  }, [request]);

  return { acquire, release };
}
