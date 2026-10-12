"use client";
import { useEffect, useState } from "react";

const KEY = "papercards_theme";
type Theme = "system" | "light" | "dark";

export function ThemeSelect() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem(KEY);
      if (t === "light" || t === "dark") setTheme(t);
    } catch {
      // storage unavailable: stay on system theme
    }
  }, []);
  function choose(t: Theme) {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      // ignore
    }
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const icon: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
  return (
    <button className="btn ghost small" onClick={() => choose(next[theme])} title={`Theme: ${theme} (click to change)`} aria-label={`Theme: ${theme}`}>
      {icon[theme]}
    </button>
  );
}
