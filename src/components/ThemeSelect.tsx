"use client";
import { useSyncExternalStore } from "react";

const KEY = "papercards_theme";
const EVENT = "papercards-theme";
type Theme = "system" | "light" | "dark";

function read(): Theme {
  const t = typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined;
  return t === "light" || t === "dark" ? t : "system";
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function ThemeSelect() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  function choose(t: Theme) {
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      // storage unavailable: theme still applies for this visit
    }
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    window.dispatchEvent(new Event(EVENT));
  }
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const icon: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
  return (
    <button className="btn ghost small" onClick={() => choose(next[theme])} title={`Theme: ${theme} (click to change)`} aria-label={`Theme: ${theme}`}>
      {icon[theme]}
    </button>
  );
}
