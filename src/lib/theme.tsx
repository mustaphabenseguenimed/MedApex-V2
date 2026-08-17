import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "medapex.theme";

type Ctx = {
  theme: ThemeMode;
  resolved: ResolvedTheme;
  setTheme: (t: ThemeMode) => void;
};

const ThemeCtx = createContext<Ctx>({
  theme: "system",
  resolved: "dark",
  setTheme: () => {},
});

function systemPref(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    theme === "system" ? systemPref() : theme,
  );

  useEffect(() => {
    const next: ResolvedTheme = theme === "system" ? systemPref() : theme;
    setResolved(next);
    apply(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const r: ResolvedTheme = mq.matches ? "light" : "dark";
      setResolved(r);
      apply(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <ThemeCtx.Provider value={{ theme, resolved, setTheme: setThemeState }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}

/**
 * Inline script string injected in <head> to apply the stored/system theme
 * synchronously before hydration, preventing a flash of the wrong theme.
 */
export const themeInitScript = `(function(){try{var s=localStorage.getItem('${STORAGE_KEY}');var m=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';var r=(s==='light'||s==='dark')?s:m;var d=document.documentElement;if(r==='dark')d.classList.add('dark');else d.classList.remove('dark');d.style.colorScheme=r;}catch(e){}})();`;