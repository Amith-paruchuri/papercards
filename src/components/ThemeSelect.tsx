"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun, CircleHalf } from "@phosphor-icons/react";
import { applyTheme, nextTheme, readTheme, THEME_EVENT, type Theme } from "@/lib/theme";

function subscribe(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}

export function ThemeSelect() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  const label = { system: "Theme: matches your system", light: "Theme: light", dark: "Theme: dark" }[theme];
  return (
    <button className="icon-btn" onClick={() => applyTheme(nextTheme(theme))} title={label} aria-label={label}>
      {theme === "dark" ? <Moon size={17} /> : theme === "light" ? <Sun size={17} /> : <CircleHalf size={17} />}
    </button>
  );
}
