import "server-only";
// Server-side AI calls shared by the AI routes. Keys never leave the server.
// Gemini (GEMINI_API_KEY, Google AI Studio) is used when set, otherwise Anthropic (ANTHROPIC_API_KEY).

const BASE = () => process.env.PAPERCARDS_AI_BASE_URL;
type Result = { text: string } | { status: number };
/** "fast": Flash-Lite first (one-line notes). "smart": full Flash first (organising a whole library). */
export type Prefer = "fast" | "smart";

export function aiConfigured(ownKey?: string | null): boolean {
  return Boolean(ownKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/** A researcher's own Google AI Studio key, sent per request from their browser in this header.
 *  It is used for that one call and never stored or logged on the server. */
export const OWN_KEY_HEADER = "x-papercards-ai-key";
export function ownKeyFrom(headers: Headers): string | null {
  const k = headers.get(OWN_KEY_HEADER)?.trim();
  return k && /^[A-Za-z0-9_\-]{20,120}$/.test(k) ? k : null;
}
/** Error text for a failed call: a rejected own key gets its own message so people know what to fix. */
export function aiErrorMessage(status: number, ownKey: string | null): { error: string; status: number } {
  if (ownKey && [400, 401, 403].includes(status)) return { error: "Google rejected your own API key. Check it under AI settings, or remove it to use PaperCards' AI.", status: 400 };
  if (status === 429) return { error: ownKey ? "Your own API key has hit its rate limit. Try again in a minute." : "The AI is busy right now. Try again in a minute.", status: 429 };
  return { error: "The AI service didn't answer. Try again in a moment.", status: 502 };
}

/** Runs one prompt and returns the model's text, or the HTTP status of the last failure.
 *  With `ownKey` the call runs on the researcher's own Gemini key instead of the site's. */
export async function generate(system: string, user: string, maxTokens: number, prefer: Prefer = "fast", ownKey?: string | null): Promise<Result> {
  if (ownKey) return callGemini(ownKey, system, user, maxTokens, prefer);
  const gemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (gemini) return callGemini(gemini, system, user, maxTokens, prefer);
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (anthropic) return callAnthropic(anthropic, system, user, maxTokens);
  return { status: 503 };
}

// Google AI Studio (Gemini). Flash-Lite first (fast, rarely overloaded, plenty for one-line notes), then the
// bigger Flash models. Each model gets a short time limit; busy, retired or slow models are skipped.
async function callGemini(key: string, system: string, user: string, maxTokens: number, prefer: Prefer): Promise<Result> {
  const order =
    prefer === "smart"
      ? ["gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"]
      : ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash"];
  const models = [
    ...new Set(
      [prefer === "smart" ? process.env.GEMINI_SMART_MODEL : process.env.GEMINI_MODEL, ...order].filter(
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
        signal: AbortSignal.timeout(Math.min(prefer === "smart" ? 40000 : 15000, left)),
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
