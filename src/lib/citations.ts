// BibTeX and RIS export. Pure functions (tested).
import type { Author, PaperMeta } from "./types";

type Citable = PaperMeta & { id?: string; subjects?: string[]; tags?: string[] };

// ---------------------------------------------------------------------------
// Author helpers
// ---------------------------------------------------------------------------
export function formatAuthorShort(authors: Author[]): string {
  if (!authors.length) return "";
  const first = authors[0].family;
  if (authors.length === 1) return first;
  if (authors.length === 2) return `${first} & ${authors[1].family}`;
  return `${first} et al.`;
}

export function citationLabel(p: Pick<PaperMeta, "authors" | "year">): string {
  return [formatAuthorShort(p.authors), p.year ?? ""].filter(Boolean).join(" ").trim();
}

/** "Given Family" display list, e.g. for card headers. */
export function formatAuthorsFull(authors: Author[], max = 6): string {
  const names = authors.map((a) => [a.given, a.family].filter(Boolean).join(" "));
  if (names.length <= max) return names.join(", ");
  return names.slice(0, max).join(", ") + ` +${names.length - max}`;
}

/** Parse "Smith J, Doe A" / "Jane Smith; John Doe" / "Smith, Jane and Doe, John" into authors. */
export function parseAuthorList(input: string): Author[] {
  const s = input.trim();
  if (!s) return [];
  let parts: string[];
  if (/\band\b/i.test(s) && s.includes(",")) {
    // BibTeX style "Family, Given and Family, Given"
    parts = s.split(/\s+and\s+/i);
    const out: Author[] = [];
    for (const part of parts) {
      const [family, given] = part.split(",").map((x) => x.trim());
      if (family) out.push(given ? { family, given } : { family });
    }
    return out;
  }
  parts = s.split(/\s*;\s*|\s*,\s*|\s+and\s+/i).filter(Boolean);
  return parts.map((p) => {
    const words = p.trim().split(/\s+/);
    if (words.length === 1) return { family: words[0] };
    // "Smith J" or "Smith JA" (family first, initials after)
    const last = words[words.length - 1];
    if (/^[A-Z]{1,3}\.?$/.test(last.replace(/\./g, "")) && words.length === 2) {
      return { family: words[0], given: last };
    }
    return { family: last, given: words.slice(0, -1).join(" ") };
  });
}

// ---------------------------------------------------------------------------
// BibTeX
// ---------------------------------------------------------------------------
const BIBTEX_TYPES: Record<string, string> = {
  article: "article",
  conference: "inproceedings",
  chapter: "incollection",
  book: "book",
  thesis: "phdthesis",
  report: "techreport",
  preprint: "misc",
  dataset: "misc",
};

function asciiFold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function bibEscape(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([{}&%$#_])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

export function bibKey(p: Citable, used?: Set<string>): string {
  const family = p.authors[0]?.family ? asciiFold(p.authors[0].family).replace(/[^A-Za-z]/g, "") : "anon";
  const word =
    asciiFold(p.title || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .find((w) => w.length > 3 && !["with", "from", "into", "that", "this", "their", "between"].includes(w)) || "";
  const base = `${family.toLowerCase()}${p.year ?? ""}${word}` || "ref";
  if (!used) return base;
  let key = base;
  let i = 0;
  while (used.has(key)) key = base + String.fromCharCode(97 + i++); // a, b, c...
  used.add(key);
  return key;
}

export function toBibTeX(p: Citable, key?: string): string {
  const type = BIBTEX_TYPES[p.item_type] || "article";
  const fields: [string, string | null | undefined][] = [
    ["title", p.title ? `{${bibEscape(p.title)}}` : null],
    ["author", p.authors.length ? p.authors.map((a) => (a.given ? bibEscape(`${a.family}, ${a.given}`) : `{${bibEscape(a.family)}}`)).join(" and ") : null],
    [type === "incollection" || type === "inproceedings" ? "booktitle" : "journal", p.journal ? bibEscape(p.journal) : null],
    ["year", p.year ? String(p.year) : null],
    ["volume", p.volume ? bibEscape(p.volume) : null],
    ["number", p.issue ? bibEscape(p.issue) : null],
    ["pages", p.pages ? bibEscape(p.pages.replace(/\s*[-–—]\s*/, "--")) : null],
    ["publisher", p.publisher ? bibEscape(p.publisher) : null],
    ["doi", p.doi],
    ["url", p.url],
    ["abstract", p.abstract ? bibEscape(p.abstract.replace(/\s+/g, " ")) : null],
    ["keywords", [...(p.tags ?? []), ...(p.subjects ?? [])].length ? bibEscape([...(p.tags ?? []), ...(p.subjects ?? [])].join(", ")) : null],
  ];
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@${type}{${key ?? bibKey(p)},\n${body}\n}`;
}

export function toBibTeXAll(papers: Citable[]): string {
  const used = new Set<string>();
  return papers.map((p) => toBibTeX(p, bibKey(p, used))).join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// RIS
// ---------------------------------------------------------------------------
const RIS_TYPES: Record<string, string> = {
  article: "JOUR",
  conference: "CPAPER",
  chapter: "CHAP",
  book: "BOOK",
  thesis: "THES",
  report: "RPRT",
  preprint: "UNPB",
  dataset: "DATA",
};

export function toRIS(p: Citable): string {
  const lines: string[] = [`TY  - ${RIS_TYPES[p.item_type] || "JOUR"}`];
  const add = (tag: string, v: string | number | null | undefined) => {
    if (v === null || v === undefined || v === "") return;
    lines.push(`${tag}  - ${String(v).replace(/\s*\n\s*/g, " ")}`);
  };
  add("TI", p.title);
  for (const a of p.authors) add("AU", a.given ? `${a.family}, ${a.given}` : a.family);
  add("PY", p.year);
  add("T2", p.journal);
  add("VL", p.volume);
  add("IS", p.issue);
  if (p.pages) {
    const [sp, ep] = p.pages.split(/\s*[-–—]+\s*/);
    add("SP", sp);
    add("EP", ep);
  }
  add("PB", p.publisher);
  add("DO", p.doi);
  add("UR", p.url);
  add("AB", p.abstract);
  for (const k of [...(p.tags ?? []), ...(p.subjects ?? [])]) add("KW", k);
  lines.push("ER  - ");
  return lines.join("\r\n");
}

export function toRISAll(papers: Citable[]): string {
  return papers.map(toRIS).join("\r\n\r\n") + "\r\n";
}
