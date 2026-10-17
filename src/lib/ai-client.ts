"use client";
import type { AiMode, AiPassage } from "./ai-notes";

const PREF = "papercards_ai_auto";

export async function rewriteWithAi(passages: AiPassage[], opts: { mode?: AiMode; section?: string; paperTitle?: string; instruction?: string } = {}): Promise<AiPassage[]> {
  const res = await fetch("/api/ai/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
