// Parse the single-file prototype's localStorage export ("papercards_v1") into import-ready records.
// Pure functions except where noted, so they can be unit tested.
import { parseAuthorList } from "./citations";
import { normalizeDoi } from "./doi";
import type { Author, HighlightRect, PaperStatus } from "./types";

export interface LegacyHighlight {
  id?: string;
  type?: string;
  page?: number;
  text?: string;
  section?: string | null;
  rects?: { xPct: number; yPct: number; wPct: number; hPct: number }[];
}

export interface LegacyCard {
  id: string;
  title?: string;
  authors?: string;
  journal?: string;
  year?: string | number;
  doi?: string;
  abstract?: string;
  notes?: Partial<Record<"introduction" | "methods" | "results" | "discussion", string>>;
  status?: string;
  labels?: string[];
  deckIds?: string[];
  highlights?: LegacyHighlight[];
  pdfData?: string | null;
}

export interface LegacyState {
  cards: LegacyCard[];
  decks: { id: string; name: string }[];
}

export interface ImportCard {
  legacyId: string;
  title: string;
  authors: Author[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  abstract: string | null;
  status: PaperStatus;
  labels: string[];
  deckIds: string[];
  notes: Record<string, string>; // section title -> raw html/text
  highlights: { page: number; text: string; sectionTitle: string | null; rects: HighlightRect[] }[];
  pdfDataUrl: string | null;
}

const SECTION_TITLES: Record<string, string> = {
  introduction: "Introduction",
  methods: "Methods",
  results: "Results",
  discussion: "Discussion",
};

const STATUS_MAP: Record<string, PaperStatus> = { stub: "to_read", read: "read", annotated: "annotated" };

export function parseLegacyExport(json: string): LegacyState {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON. Export it again with the snippet above.");
  }
  // Accept either the raw state or a string-wrapped copy (if someone copied the localStorage value as a string).
  if (typeof data === "string") data = JSON.parse(data);
  const state = data as Partial<LegacyState>;
  if (!state || !Array.isArray(state.cards)) throw new Error("This doesn't look like an old Paper Cards export (no cards found).");
  return { cards: state.cards, decks: Array.isArray(state.decks) ? state.decks : [] };
}

export function toImportCard(c: LegacyCard): ImportCard {
  const year = parseInt(String(c.year ?? ""), 10);
  const notes: Record<string, string> = {};
  for (const [k, title] of Object.entries(SECTION_TITLES)) {
    const v = (c.notes as Record<string, string | undefined> | undefined)?.[k];
    if (v && v.trim()) notes[title] = v;
  }
  return {
    legacyId: String(c.id),
    title: (c.title || "").trim() || "Untitled",
    authors: c.authors ? parseAuthorList(c.authors) : [],
    year: Number.isFinite(year) && year > 1000 && year < 3000 ? year : null,
    journal: c.journal?.trim() || null,
    doi: normalizeDoi(c.doi),
    abstract: c.abstract?.trim() || null,
    status: STATUS_MAP[c.status ?? ""] ?? "to_read",
    labels: (c.labels ?? []).map((l) => String(l).trim()).filter(Boolean),
    deckIds: c.deckIds ?? [],
    notes,
    highlights: (c.highlights ?? [])
      .filter((h) => (h.type ?? "pdf") === "pdf" && typeof h.page === "number" && h.page >= 1)
      .map((h) => ({
        page: h.page!,
        text: h.text ?? "",
        sectionTitle: h.section ? SECTION_TITLES[h.section] ?? null : null,
        rects: (h.rects ?? []).map((r) => ({ x: r.xPct, y: r.yPct, w: r.wPct, h: r.hPct })),
      })),
    pdfDataUrl: c.pdfData && c.pdfData.startsWith("data:application/pdf") ? c.pdfData : null,
  };
}

/** Legacy notes were plain text or simple editor HTML; return HTML either way. */
export function legacyNoteToHtml(value: string): string {
  if (/<\/?(?:b|strong|i|em|u|ul|ol|li|div|br|a|p)(?:\s[^>]*)?>/i.test(value)) return value;
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
