import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { buildDeckPrompt, parseDeckReply, validateDeckRequest } from "@/lib/ai-decks";
import { aiConfigured, generate } from "@/lib/ai-server";

// Organising a whole library takes longer than rewriting one highlight.
export const maxDuration = 60;

// POST /api/ai/decks  { scope, papers: [{ref, title, year, journal, abstract, tags, decks}], decks: [{ref, name, size}] }
//   -> { decks: [{ name, existingRef, why, paperRefs }] }   (a proposal; nothing is changed until the user applies it)
export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.json({ error: "Sign in to organise with AI." }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ error: "AI isn't switched on for this site yet." }, { status: 503 });

  const req = validateDeckRequest(await request.json().catch(() => null));
  if (typeof req === "string") return NextResponse.json({ error: req }, { status: 400 });

  const { system, user } = buildDeckPrompt(req);
  try {
    const r = await generate(system, user, Math.min(8000, 600 + req.papers.length * 40), "smart");
    if ("status" in r) {
      return NextResponse.json({ error: r.status === 429 ? "The AI is busy right now. Try again in a minute." : "The AI service didn't answer. Try again in a moment." }, { status: r.status === 429 ? 429 : 502 });
    }
    const decks = parseDeckReply(r.text, req);
    if (!decks.length) return NextResponse.json({ error: "Every paper already sits in a deck that fits. Add new papers, or choose My whole library, and try again." }, { status: 422 });
    return NextResponse.json({ decks });
  } catch (e) {
    console.error("AI decks failed:", e);
    return NextResponse.json({ error: e instanceof SyntaxError ? "The AI reply was cut short. Try again." : "The AI service didn't answer. Try again in a moment." }, { status: 502 });
  }
}
