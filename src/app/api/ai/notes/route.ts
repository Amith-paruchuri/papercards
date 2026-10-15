import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { buildPrompt, parseReply, validateRequest } from "@/lib/ai-notes";

// POST /api/ai/notes  { mode, section?, paperTitle?, passages: [{id, text}] }  ->  { items: [{id, text}] }
// Signed-in users only. Server-only keys: GEMINI_API_KEY (Google AI Studio, preferred) or ANTHROPIC_API_KEY.
export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.json({ error: "Sign in to use AI notes." }, { status: 401 });

  const gemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!gemini && !anthropic) return NextResponse.json({ error: "AI rewriting isn't switched on for this site yet. The quote was kept as you highlighted it." }, { status: 503 });

  const req = validateRequest(await request.json().catch(() => null));
  if (typeof req === "string") return NextResponse.json({ error: req }, { status: 400 });

  const { system, user } = buildPrompt(req);
  const maxTokens = Math.min(4000, 200 + req.passages.length * 220);
  try {
    const r = gemini ? await callGemini(gemini, system, user, maxTokens) : await callAnthropic(anthropic!, system, user, maxTokens);
    if ("status" in r) {
      const status = r.status === 429 ? 429 : 502;
      return NextResponse.json({ error: status === 429 ? "The AI is busy right now. Try again in a minute." : "The AI service didn't answer. Try again in a moment." }, { status });
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

const BASE = () => process.env.PAPERCARDS_AI_BASE_URL;
type Result = { text: string } | { status: number };

// Google AI Studio (Gemini). Flash-Lite first (fast, rarely overloaded, plenty for one-line notes), then the
// bigger Flash models. Each model gets a short time limit; busy, retired or slow models are skipped.
async function callGemini(key: string, system: string, user: string, maxTokens: number): Promise<Result> {
  const models = [
    ...new Set(
      [process.env.GEMINI_MODEL, "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash"].filter(
        (m): m is string => Boolean(m)
      )
    ),
  ];
  const deadline = Date.now() + 50000;
  let last = 502;
  for (const model of models) {
    const left = deadline - Date.now();
    if (left < 3000) break;
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${BASE() || "https://generativelanguage.googleapis.com"}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          // Newer Gemini models spend part of the output budget on thinking, so leave generous room.
          generationConfig: { temperature: 0.2, maxOutputTokens: Math.max(maxTokens * 4, 4096), responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(Math.min(15000, left)),
        cache: "no-store",
      });
    } catch (e) {
      console.error("AI notes: Gemini", model, "gave no answer in time", e instanceof Error ? e.name : e);
      last = 504;
      continue;
    }
    if (res.ok) {
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      console.info("AI notes: Gemini", model, "answered in", Date.now() - t0, "ms");
      return { text: (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("") };
    }
    last = res.status;
    console.error("AI notes: Gemini", model, "returned", res.status, (await res.text().catch(() => "")).slice(0, 300));
    // A retired name (404) or a busy/overloaded model (429, 5xx) is worth trying on the next model.
    // A bad key or bad request (400, 401, 403) will fail the same way everywhere, so stop.
    if (![404, 429, 500, 502, 503, 504].includes(res.status)) break;
  }
  return { status: last };
}

async function callAnthropic(key: string, system: string, user: string, maxTokens: number): Promise<Result> {
  const res = await fetch(`${BASE() || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("AI notes: Anthropic API returned", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return { status: res.status };
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return { text: (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("") };
}
