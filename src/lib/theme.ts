"use client";
export type Theme = "system" | "light" | "dark";
const KEY = "papercards_theme";
export const THEME_EVENT = "papercards-theme";

export function readTheme(): Theme {
  const t = typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined;
  return t === "light" || t === "dark" ? t : "system";
}

export function applyTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // storage unavailable: the theme still applies for this visit
  }
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Cycles system -> light -> dark, picking the visible opposite first so one click always changes the look. */
export function nextTheme(t: Theme): Theme {
  if (t === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark";
  return t === "light" ? "dark" : "system";
}
