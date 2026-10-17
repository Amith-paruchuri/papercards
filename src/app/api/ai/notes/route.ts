import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { buildPrompt, parseReply, validateRequest } from "@/lib/ai-notes";
import { aiConfigured, aiErrorMessage, generate, ownKeyFrom } from "@/lib/ai-server";

// POST /api/ai/notes  { mode, section?, paperTitle?, passages: [{id, text}] }  ->  { items: [{id, text}] }
// Signed-in users only. Server-only keys: GEMINI_API_KEY (Google AI Studio, preferred) or ANTHROPIC_API_KEY.
export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.json({ error: "Sign in to use AI notes." }, { status: 401 });

  const ownKey = ownKeyFrom(request.headers);
  if (!aiConfigured(ownKey)) return NextResponse.json({ error: "AI rewriting isn't switched on for this site yet. The quote was kept as you highlighted it." }, { status: 503 });

  const req = validateRequest(await request.json().catch(() => null));
  if (typeof req === "string") return NextResponse.json({ error: req }, { status: 400 });

  const { system, user } = buildPrompt(req);
  const maxTokens = Math.min(4000, 200 + req.passages.length * 220);
  try {
    const r = await generate(system, user, maxTokens, "fast", ownKey);
    if ("status" in r) {
      const { error, status } = aiErrorMessage(r.status, ownKey);
      return NextResponse.json({ error }, { status });
    }
    const text = r.text;
    const items = parseReply(text, req.passages.map((p) => p.id));
    return NextResponse.json({ items });
  } catch (e) {
    console.error("AI notes failed:", e);
    const msg = e instanceof Error && e.name === "TimeoutError" ? "The AI took too long. Try fewer highlights at once." : "The AI service didn't answer. Try again in a moment.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
