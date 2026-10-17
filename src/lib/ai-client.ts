"use client";
import type { AiMode, AiPassage } from "./ai-notes";

const PREF = "papercards_ai_auto";
const OWN_KEY = "papercards_own_ai_key";

/** The researcher's own Google AI Studio key, kept only in this browser. */
export function readOwnKey(): string {
  try {
    return localStorage.getItem(OWN_KEY) ?? "";
  } catch {
    return "";
  }
}
export function writeOwnKey(key: string) {
  try {
    if (key) localStorage.setItem(OWN_KEY, key);
    else localStorage.removeItem(OWN_KEY);
  } catch {}
}
/** Headers for the AI routes: JSON, plus the own key when one is set. */
export function aiHeaders(): Record<string, string> {
  const k = readOwnKey();
  return k ? { "content-type": "application/json", "x-papercards-ai-key": k } : { "content-type": "application/json" };
}

export async function rewriteWithAi(passages: AiPassage[], opts: { mode?: AiMode; section?: string; paperTitle?: string; instruction?: string } = {}): Promise<AiPassage[]> {
  const res = await fetch("/api/ai/notes", {
    method: "POST",
    headers: aiHeaders(),
    body: JSON.stringify({ mode: opts.mode ?? "concise", section: opts.section, paperTitle: opts.paperTitle, instruction: opts.instruction, passages }),
  });
  const body = (await res.json().catch(() => ({}))) as { items?: AiPassage[]; error?: string };
  if (!res.ok || !body.items) throw new Error(body.error || "AI rewriting failed. Try again in a moment.");
  return body.items;
}

export function readAiAuto(): boolean {
  try {
    return localStorage.getItem(PREF) === "1";
  } catch {
    return false;
  }
}
export function writeAiAuto(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? "1" : "0");
  } catch {}
}

/** Tries a key with one tiny request before it is saved, so a typo shows up straight away. */
export async function testOwnKey(key: string): Promise<void> {
  const res = await fetch("/api/ai/notes", {
    method: "POST",
    headers: { "content-type": "application/json", "x-papercards-ai-key": key.trim() },
    body: JSON.stringify({ mode: "clean", passages: [{ id: "t", text: "Key check." }] }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || "That key didn't work. Check it and try again.");
}
