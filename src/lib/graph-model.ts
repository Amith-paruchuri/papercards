// The research graph: decks are hubs, papers are cards orbiting the decks they belong to.
// A paper in two decks is a bridge between them; decks that share papers are linked directly.
// Optional extra threads join papers that share a tag or an author. Pure data, no DOM.
import type { Collection, LibraryPaper, PaperStatus, Tag } from "./types";

export const DECK_HUES = ["#2d4f8f", "#3d7a57", "#c46a2b", "#7a5aa8", "#2b8a96", "#b5527a", "#a8841c", "#5b6472"];
export const LOOSE_ID = "deck:loose";

export type DeckNode = { kind: "deck"; id: string; deckId: string | null; label: string; color: string; size: number };
export type PaperNode = {
  kind: "paper";
  id: string;
  paperId: string;
  label: string;
  byline: string;
  status: PaperStatus;
  decks: string[]; // deck node ids
  color: string; // colour of its first deck
  mine: boolean;
  noted: number; // sections with notes
  sections: number;
};
export type GraphNode = DeckNode | PaperNode;
export type LinkKind = "member" | "deck" | "tag" | "author";
export type GraphLink = { id: string; source: string; target: string; kind: LinkKind; weight: number; label?: string };
export type Graph = { nodes: GraphNode[]; links: GraphLink[] };

export type GraphOptions = {
  /** Show only this deck, its papers, and the decks those papers also belong to. */
  focusDeck?: string | null;
  tagThreads?: boolean;
  authorThreads?: boolean;
  /** Papers in no deck get a "Loose papers" hub so nothing floats unattached. */
  includeLoose?: boolean;
};

const authorKey = (a: { family?: string; given?: string }) => `${(a.family || "").toLowerCase()}|${(a.given || "").trim().charAt(0).toLowerCase()}`;

export function byline(p: Pick<LibraryPaper, "authors" | "year">): string {
  const a = p.authors ?? [];
  const first = a[0]?.family ?? "";
  const who = a.length > 2 ? `${first} et al.` : a.length === 2 ? `${first} & ${a[1].family}` : first;
  return [who, p.year].filter(Boolean).join(", ");
}

export function buildGraph(papers: LibraryPaper[], collections: Collection[], tags: Tag[], opts: GraphOptions = {}): Graph {
  const deckColor = new Map(collections.map((c, i) => [c.id, DECK_HUES[i % DECK_HUES.length]]));
  let pool = papers;
  let deckIds = new Set(collections.map((c) => c.id));
  if (opts.focusDeck) {
    pool = papers.filter((p) => p.collection_papers.some((c) => c.collection_id === opts.focusDeck));
    deckIds = new Set([opts.focusDeck, ...pool.flatMap((p) => p.collection_papers.map((c) => c.collection_id))]);
  }

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const deckCount = new Map<string, number>();
  for (const p of pool) for (const c of p.collection_papers) if (deckIds.has(c.collection_id)) deckCount.set(c.collection_id, (deckCount.get(c.collection_id) ?? 0) + 1);

  for (const c of collections) {
    if (!deckIds.has(c.id)) continue;
    nodes.push({ kind: "deck", id: `deck:${c.id}`, deckId: c.id, label: c.name, color: deckColor.get(c.id)!, size: deckCount.get(c.id) ?? 0 });
  }
  const loose = pool.filter((p) => !p.collection_papers.some((c) => deckIds.has(c.collection_id)));
  const withLoose = (opts.includeLoose ?? true) && loose.length > 0 && !opts.focusDeck;
  if (withLoose) nodes.push({ kind: "deck", id: LOOSE_ID, deckId: null, label: "Loose papers", color: "#8a909c", size: loose.length });

  const shown = withLoose ? pool : pool.filter((p) => !loose.includes(p));
  for (const p of shown) {
    const decks = p.collection_papers.map((c) => `deck:${c.collection_id}`).filter((d) => nodes.some((n) => n.id === d));
    if (!decks.length && withLoose) decks.push(LOOSE_ID);
    const sections = p.note_sections ?? [];
    nodes.push({
      kind: "paper",
      id: `paper:${p.id}`,
      paperId: p.id,
      label: p.title,
      byline: byline(p),
      status: p.status,
      decks,
      color: decks[0] === LOOSE_ID || !decks.length ? "#8a909c" : deckColor.get(decks[0].slice(5)) ?? "#8a909c",
      mine: Boolean(p.is_mine),
      noted: sections.filter((s) => s.has_notes).length,
      sections: sections.length,
    });
    for (const d of decks) links.push({ id: `m:${p.id}:${d}`, source: `paper:${p.id}`, target: d, kind: "member", weight: 1 });
  }

  // Deck to deck: how many papers they share.
  const shared = new Map<string, number>();
  for (const p of shown) {
    const ds = [...new Set(p.collection_papers.map((c) => c.collection_id).filter((id) => deckIds.has(id)))].sort();
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) shared.set(`${ds[i]}|${ds[j]}`, (shared.get(`${ds[i]}|${ds[j]}`) ?? 0) + 1);
  }
  for (const [k, n] of shared) {
    const [a, b] = k.split("|");
    links.push({ id: `d:${k}`, source: `deck:${a}`, target: `deck:${b}`, kind: "deck", weight: n, label: `${n} shared ${n === 1 ? "paper" : "papers"}` });
  }

  // Optional threads between papers.
  const pairLinks = (kind: "tag" | "author", keyOf: (p: LibraryPaper) => string[], name: (k: string) => string) => {
    const groups = new Map<string, string[]>();
    for (const p of shown) for (const k of new Set(keyOf(p))) groups.set(k, [...(groups.get(k) ?? []), p.id]);
    const seen = new Map<string, GraphLink>();
    for (const [k, ids] of groups) {
      if (ids.length < 2 || ids.length > 12) continue; // a tag on everything is noise, not a thread
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const [a, b] = [ids[i], ids[j]].sort();
          const id = `${kind}:${a}:${b}`;
          const prev = seen.get(id);
          if (prev) prev.weight++;
          else seen.set(id, { id, source: `paper:${a}`, target: `paper:${b}`, kind, weight: 1, label: name(k) });
        }
    }
    links.push(...seen.values());
  };
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  if (opts.tagThreads) pairLinks("tag", (p) => p.paper_tags.map((t) => t.tag_id), (k) => `#${tagName.get(k) ?? "tag"}`);
  if (opts.authorThreads) pairLinks("author", (p) => (p.authors ?? []).map(authorKey).filter((k) => k !== "|"), (k) => k.split("|")[0].replace(/^./, (c) => c.toUpperCase()));

  return { nodes, links };
}

/** Papers and decks one step away from a node (for hover highlighting). */
export function neighbours(graph: Graph, id: string): Set<string> {
  const out = new Set([id]);
  for (const l of graph.links) {
    if (l.source === id) out.add(l.target);
    else if (l.target === id) out.add(l.source);
  }
  return out;
}
