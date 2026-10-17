// "My publications": turning ORCID, OpenAlex and BibTeX (Google Scholar / ResearchGate export) into papers.
// Pure functions only (no DOM, no network) so they run on the server route and in tests.
import type { Author } from "./types";

export type Work = {
  title: string;
  authors: Author[];
  year: number | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  url: string | null;
  item_type: string;
};

export type AuthorCandidate = { id: string; name: string; institution: string | null; works: number; orcid: string | null };

const clean = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t || null;
};

export function normalizeDoi(raw: unknown): string | null {
  const s = clean(raw);
  if (!s) return null;
  const m = s.match(/10\.\d{4,9}\/\S+/i);
  return m ? m[0].replace(/[.,;)\]]+$/, "").toLowerCase() : null;
}

/** Accepts "0000-0002-1825-0097", the orcid.org URL, or the 16 digits; checks the ISO 7064 checksum. */
export function normalizeOrcid(raw: string): string | null {
  const digits = (raw || "").toUpperCase().replace(/[^0-9X]/g, "").slice(-16);
  if (!/^\d{15}[\dX]$/.test(digits)) return null;
  let total = 0;
  for (const ch of digits.slice(0, 15)) total = (total + Number(ch)) * 2;
  const r = (12 - (total % 11)) % 11;
  const check = r === 10 ? "X" : String(r);
  if (check !== digits[15]) return null;
  return digits.replace(/(.{4})(?=.)/g, "$1-");
}

/** "Amith V Paruchuri" -> { given: "Amith V", family: "Paruchuri" }; "Paruchuri, Amith" also works. */
export function splitName(display: string): Author {
  const s = (display || "").replace(/\s+/g, " ").trim();
  if (s.includes(",")) {
    const [family, given] = s.split(",", 2).map((x) => x.trim());
    return given ? { family, given } : { family };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { family: s };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

const typeMap: Record<string, string> = {
  "journal-article": "article",
  article: "article",
  review: "article",
  preprint: "preprint",
  "posted-content": "preprint",
  book: "book",
  "book-chapter": "chapter",
  "conference-paper": "article",
  dissertation: "thesis",
  "dissertation-thesis": "thesis",
};

// ---------------------------------------------------------------------------
// ORCID public API v3.0: /{id}/works
// ---------------------------------------------------------------------------
type OrcidSummary = {
  title?: { title?: { value?: string } };
  "publication-date"?: { year?: { value?: string } } | null;
  "journal-title"?: { value?: string } | null;
  type?: string;
  url?: { value?: string } | null;
  "external-ids"?: { "external-id"?: { "external-id-type"?: string; "external-id-value"?: string; "external-id-normalized"?: { value?: string } }[] } | null;
};

export function fromOrcidWorks(json: unknown): Work[] {
  const groups = (json as { group?: { "work-summary"?: OrcidSummary[] }[] })?.group ?? [];
  const out: Work[] = [];
  for (const g of groups) {
    const s = g["work-summary"]?.[0];
    const title = clean(s?.title?.title?.value);
    if (!s || !title) continue;
    const doiId = s["external-ids"]?.["external-id"]?.find((x) => (x["external-id-type"] || "").toLowerCase() === "doi");
    const year = Number(s["publication-date"]?.year?.value);
    out.push({
      title,
      authors: [],
      year: Number.isFinite(year) && year > 1000 ? year : null,
      journal: clean(s["journal-title"]?.value),
      volume: null,
      issue: null,
      pages: null,
      doi: normalizeDoi(doiId?.["external-id-normalized"]?.value ?? doiId?.["external-id-value"]),
      url: clean(s.url?.value),
      item_type: typeMap[s.type ?? ""] ?? "article",
    });
  }
  return dedupeWorks(out);
}

// ---------------------------------------------------------------------------
// OpenAlex (open index covering most of what Google Scholar lists)
// ---------------------------------------------------------------------------
type OpenAlexWork = {
  doi?: string | null;
  display_name?: string | null;
  title?: string | null;
  publication_year?: number | null;
  type?: string | null;
  primary_location?: { source?: { display_name?: string | null } | null; landing_page_url?: string | null } | null;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null;
  authorships?: { author?: { display_name?: string | null } | null }[];
};

export function fromOpenAlexWork(w: OpenAlexWork): Work | null {
  const title = clean(w.display_name ?? w.title);
  if (!title) return null;
  const b = w.biblio ?? {};
  const pages = b.first_page ? (b.last_page && b.last_page !== b.first_page ? `${b.first_page}-${b.last_page}` : b.first_page) : null;
  return {
    title,
    authors: (w.authorships ?? []).map((a) => clean(a.author?.display_name)).filter((n): n is string => Boolean(n)).map(splitName),
    year: w.publication_year ?? null,
    journal: clean(w.primary_location?.source?.display_name),
    volume: clean(b.volume),
    issue: clean(b.issue),
    pages,
    doi: normalizeDoi(w.doi),
    url: clean(w.primary_location?.landing_page_url),
    item_type: typeMap[w.type ?? ""] ?? "article",
  };
}

export function fromOpenAlexAuthors(json: unknown): AuthorCandidate[] {
  const results = (json as { results?: { id?: string; display_name?: string; works_count?: number; orcid?: string | null; last_known_institutions?: { display_name?: string }[] }[] })?.results ?? [];
  return results
    .filter((r) => r.id && r.display_name)
    .map((r) => ({
      id: String(r.id).replace(/^https?:\/\/openalex\.org\//, ""),
      name: String(r.display_name),
      institution: clean(r.last_known_institutions?.[0]?.display_name),
      works: r.works_count ?? 0,
      orcid: r.orcid ? normalizeOrcid(r.orcid) : null,
    }));
}

/** ORCID summaries have no author list; fill gaps from OpenAlex records with the same DOI. */
export function enrichWorks(base: Work[], extra: Work[]): Work[] {
  const byDoi = new Map(extra.filter((w) => w.doi).map((w) => [w.doi!, w]));
  return base.map((w) => {
    const e = w.doi ? byDoi.get(w.doi) : undefined;
    if (!e) return w;
    return {
      ...w,
      authors: w.authors.length ? w.authors : e.authors,
      journal: w.journal ?? e.journal,
      year: w.year ?? e.year,
      volume: w.volume ?? e.volume,
      issue: w.issue ?? e.issue,
      pages: w.pages ?? e.pages,
      url: w.url ?? e.url,
    };
  });
}

const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function dedupeWorks(works: Work[]): Work[] {
  const seen = new Set<string>();
  const out: Work[] = [];
  for (const w of works) {
    const keys = [w.doi ? `doi:${w.doi}` : null, `t:${titleKey(w.title)}`].filter(Boolean) as string[];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(w);
  }
  return out;
}

// ---------------------------------------------------------------------------
// BibTeX (Google Scholar: select your articles > Export > BibTeX; ResearchGate: Download citation > BibTeX)
// ---------------------------------------------------------------------------
function readValue(src: string, i: number): [string, number] {
  // returns [value, index after value]
  while (/\s/.test(src[i] ?? "")) i++;
  if (src[i] === "{") {
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return [src.slice(i + 1, j), j + 1];
  }
  if (src[i] === '"') {
    let j = i + 1;
    let depth = 0;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      else if (src[j] === '"' && depth === 0 && src[j - 1] !== "\\") break;
    }
    return [src.slice(i + 1, j), j + 1];
  }
  const m = /^[^,}\s]+/.exec(src.slice(i));
  return [m ? m[0] : "", i + (m ? m[0].length : 0)];
}

const LATEX: [RegExp, string][] = [
  [/\\&/g, "&"],
  [/\\%/g, "%"],
  [/\\_/g, "_"],
  [/\\textendash\s?|--/g, "–"],
  [/\\["'`^~=.]\{?([A-Za-z])\}?/g, "$1"],
  [/\\[a-zA-Z]+\s?/g, ""],
  [/[{}]/g, ""],
];
const unlatex = (s: string) => LATEX.reduce((t, [re, to]) => t.replace(re, to), s).replace(/\s+/g, " ").trim();

export function parseBibTeX(text: string): Work[] {
  const out: Work[] = [];
  const re = /@(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const kind = m[1].toLowerCase();
    if (kind === "comment" || kind === "string" || kind === "preamble") continue;
    let i = re.lastIndex;
    const comma = text.indexOf(",", i);
    if (comma < 0) break;
    i = comma + 1;
    const fields: Record<string, string> = {};
    while (i < text.length) {
      while (/[\s,]/.test(text[i] ?? "")) i++;
      if (text[i] === "}" || i >= text.length) break;
      const nm = /^([A-Za-z][\w-]*)\s*=/.exec(text.slice(i));
      if (!nm) break;
      i += nm[0].length;
      const [val, next] = readValue(text, i);
      fields[nm[1].toLowerCase()] = val;
      i = next;
    }
    re.lastIndex = i;
    const title = unlatex(fields.title ?? "");
    if (!title) continue;
    const year = Number((fields.year ?? "").match(/\d{4}/)?.[0]);
    out.push({
      title,
      authors: (fields.author ?? "")
        .split(/\s+and\s+/i)
        .map((a) => unlatex(a))
        .filter((a) => a && a.toLowerCase() !== "others")
        .map(splitName),
      year: Number.isFinite(year) && year > 1000 ? year : null,
      journal: unlatex(fields.journal ?? fields.booktitle ?? fields.publisher ?? "") || null,
      volume: clean(unlatex(fields.volume ?? "")),
      issue: clean(unlatex(fields.number ?? fields.issue ?? "")),
      pages: clean(unlatex(fields.pages ?? "")),
      doi: normalizeDoi(fields.doi ?? fields.url ?? ""),
      url: clean(fields.url ?? ""),
      item_type: kind === "book" ? "book" : kind === "inbook" || kind === "incollection" ? "chapter" : kind === "phdthesis" || kind === "mastersthesis" ? "thesis" : "article",
    });
  }
  return dedupeWorks(out);
}
