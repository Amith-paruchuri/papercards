// Shared pieces of "Rewrite with AI": request/response shapes, the prompt, and a forgiving parser.
// The API call itself lives in src/app/api/ai/notes/route.ts (server only, key never reaches the browser).

export type AiMode = "concise" | "clean" | "custom";
export type AiPassage = { id: string; text: string };
export type AiRequest = { mode: AiMode; section?: string; paperTitle?: string; passages: AiPassage[]; instruction?: string };

export const AI_LIMITS = { passages: 20, charsPerPassage: 4000 };

export function buildPrompt(req: AiRequest): { system: string; user: string } {
  const how =
    req.mode === "custom"
      ? "Follow the researcher's instruction (given before the passages) for each passage in at most 70 words, grounded in the passage and general scientific knowledge; say so plainly if the passage cannot answer it. Keep every number, unit and name exactly."
      : req.mode === "clean"
      ? "Keep the author's wording. Only repair PDF copy damage: broken words, stray line breaks, ligatures, citation numbers, missing spaces. Do not shorten."
      : "Rewrite each passage as one clear note bullet a researcher would write: at most 30 words, plain language, keep every number, unit, statistic, gene/drug/model name and abbreviation exactly. Do not add facts, opinions or hedges that are not in the passage.";
  const system = [
    "You turn passages highlighted in research papers into notes.",
    how,
    "Write in the same language as the passage. No markdown, no leading dash or bullet character.",
    'Reply with JSON only: an array of objects {"id": string, "text": string}, one per passage, same ids, same order.',
  ].join(" ");
  const context = [req.paperTitle ? `Paper: ${req.paperTitle}` : "", req.section ? `Notes section: ${req.section}` : ""].filter(Boolean).join("\n");
  const ask = req.mode === "custom" && req.instruction ? `Instruction: ${JSON.stringify(req.instruction)}\n\n` : "";
  const user = `${context ? context + "\n\n" : ""}${ask}Passages:\n${JSON.stringify(req.passages.map((p) => ({ id: p.id, text: p.text })))}`;
  return { system, user };
}

/** Pulls the JSON array out of a model reply, tolerating code fences or a sentence around it. */
export function parseReply(reply: string, ids: string[]): AiPassage[] {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("The AI reply was not in the expected format.");
  const arr = JSON.parse(reply.slice(start, end + 1)) as unknown;
  if (!Array.isArray(arr)) throw new Error("The AI reply was not in the expected format.");
  const want = new Set(ids);
  const out: AiPassage[] = [];
  for (const item of arr) {
    if (item && typeof item === "object" && "id" in item && "text" in item) {
      const id = String((item as { id: unknown }).id);
      const text = String((item as { text: unknown }).text)
        .replace(/^\s*[-•*]\s*/, "")
        .trim();
      if (want.has(id) && text) out.push({ id, text });
    }
  }
  return out;
}

export function validateRequest(body: unknown): AiRequest | string {
  if (!body || typeof body !== "object") return "Send a JSON body.";
  const b = body as Partial<AiRequest>;
  const mode: AiMode = b.mode === "clean" ? "clean" : b.mode === "custom" ? "custom" : "concise";
  const instruction = typeof b.instruction === "string" ? b.instruction.trim().slice(0, 500) : "";
  if (mode === "custom" && !instruction) return "Write what you want the AI to do with this passage.";
  if (!Array.isArray(b.passages) || !b.passages.length) return "Nothing to rewrite.";
  if (b.passages.length > AI_LIMITS.passages) return `Rewrite at most ${AI_LIMITS.passages} highlights at a time.`;
  const passages: AiPassage[] = [];
  for (const p of b.passages) {
    if (!p || typeof p.id !== "string" || typeof p.text !== "string" || !p.text.trim()) return "Each highlight needs an id and text.";
    passages.push({ id: p.id.slice(0, 80), text: p.text.slice(0, AI_LIMITS.charsPerPassage) });
  }
  return {
    mode,
    instruction: mode === "custom" ? instruction : undefined,
    passages,
    section: typeof b.section === "string" ? b.section.slice(0, 80) : undefined,
    paperTitle: typeof b.paperTitle === "string" ? b.paperTitle.slice(0, 300) : undefined,
  };
}
