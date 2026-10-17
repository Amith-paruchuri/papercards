// "Organise into decks with AI": what we send, how we ask, and how we check the answer.
// Papers are sent with short ids (p1, p2…) to keep the prompt small; the client maps them back.

export type DeckPaper = { ref: string; title: string; year: number | null; journal: string | null; abstract: string | null; tags: string[]; decks: string[] };
export type ExistingDeck = { ref: string; name: string; size: number };
export type DeckRequest = { scope: "all" | "loose"; papers: DeckPaper[]; decks: ExistingDeck[] };
export type DeckProposal = { name: string; existingRef: string | null; why: string; paperRefs: string[] };

export const DECK_LIMITS = { papers: 400, abstractChars: 300 };

export function buildDeckPrompt(req: DeckRequest): { system: string; user: string } {
  const n = req.papers.length;
  const target = n <= 6 ? "1 to 3" : n <= 20 ? "2 to 5" : n <= 60 ? "4 to 8" : "6 to 12";
  const system = [
    "You are a research librarian organising a researcher's reading library into decks (topic folders).",
    `Group the papers into ${target} decks. Each deck is one coherent research theme a researcher would recognise:`,
    "a disease or question, a method family, or a project, whichever separates these papers best. Prefer specific names",
    '("Pathology foundation models", "Sleep in epilepsy") over vague ones ("Medicine", "AI", "Miscellaneous").',
    "Deck names: 2 to 5 words, sentence case, no numbering, no quotes.",
    "Every paper goes in exactly one primary deck. Add a paper to a second deck only when it clearly belongs to both.",
    "When an existing deck fits a theme, reuse it by giving its ref in existingRef instead of inventing a similar name.",
    "Never put a paper in a deck it is already in. Leave a deck out if it would only repeat an existing deck with no new papers.",
    "Base decisions only on the titles, journals, abstracts and tags given. Do not invent papers.",
    'Reply with JSON only: {"decks":[{"name":string,"existingRef":string|null,"why":string (one short sentence),"paperRefs":[string]}]}.',
  ].join(" ");
  const user = JSON.stringify({
    existingDecks: req.decks.map((d) => ({ ref: d.ref, name: d.name, papers: d.size })),
    papers: req.papers.map((p) => ({
      ref: p.ref,
      title: p.title,
      year: p.year ?? undefined,
      journal: p.journal ?? undefined,
      abstract: p.abstract ? p.abstract.slice(0, DECK_LIMITS.abstractChars) : undefined,
      tags: p.tags.length ? p.tags : undefined,
      inDecks: p.decks.length ? p.decks : undefined,
    })),
  });
  return { system, user };
}

/** Checks the model's answer against what we sent: known paper refs only, real existing decks only,
 *  no paper added to a deck it is already in, empty decks dropped, names tidied. */
export function parseDeckReply(reply: string, req: DeckRequest): DeckProposal[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI reply was not in the expected format. Try again.");
  const raw = JSON.parse(reply.slice(start, end + 1)) as { decks?: unknown };
  if (!Array.isArray(raw.decks)) throw new Error("The AI reply was not in the expected format. Try again.");
  const papers = new Map(req.papers.map((p) => [p.ref, p]));
  const existing = new Map(req.decks.map((d) => [d.ref, d]));
  const byName = new Map(req.decks.map((d) => [d.name.trim().toLowerCase(), d]));
  const out: DeckProposal[] = [];
  for (const d of raw.decks as { name?: unknown; existingRef?: unknown; why?: unknown; paperRefs?: unknown }[]) {
    let name = String(d?.name ?? "")
      .replace(/["“”]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    if (!name) continue;
    name = name.charAt(0).toUpperCase() + name.slice(1);
    let ex = typeof d.existingRef === "string" ? existing.get(d.existingRef) ?? null : null;
    if (!ex) ex = byName.get(name.toLowerCase()) ?? null; // model invented a name that already exists
    const refs = [...new Set(Array.isArray(d.paperRefs) ? d.paperRefs.map(String) : [])].filter((r) => {
      const p = papers.get(r);
      return p && !(ex && p.decks.includes(ex.name));
    });
    if (!refs.length) continue;
    const merge = out.find((o) => (ex ? o.existingRef === ex.ref : !o.existingRef && o.name.toLowerCase() === name.toLowerCase()));
    if (merge) {
      merge.paperRefs = [...new Set([...merge.paperRefs, ...refs])];
      continue;
    }
    out.push({ name: ex ? ex.name : name, existingRef: ex ? ex.ref : null, why: String(d.why ?? "").slice(0, 200), paperRefs: refs });
  }
  return out;
}

export function validateDeckRequest(body: unknown): DeckRequest | string {
  const b = body as Partial<DeckRequest> | null;
  if (!b || !Array.isArray(b.papers)) return "Send the papers to organise.";
  if (b.papers.length < 2) return "Add at least two papers before organising them into decks.";
  if (b.papers.length > DECK_LIMITS.papers) return `Organise at most ${DECK_LIMITS.papers} papers at a time.`;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
  return {
    scope: b.scope === "loose" ? "loose" : "all",
    papers: b.papers.map((p) => ({
      ref: String(p.ref).slice(0, 8),
      title: str(p.title, 300) || "Untitled",
      year: typeof p.year === "number" ? p.year : null,
      journal: str(p.journal, 120),
      abstract: str(p.abstract, DECK_LIMITS.abstractChars),
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 8).map((t) => String(t).slice(0, 40)) : [],
      decks: Array.isArray(p.decks) ? p.decks.slice(0, 8).map((t) => String(t).slice(0, 60)) : [],
    })),
    decks: Array.isArray(b.decks) ? b.decks.slice(0, 60).map((d) => ({ ref: String(d.ref).slice(0, 8), name: String(d.name).slice(0, 60), size: Number(d.size) || 0 })) : [],
  };
}
