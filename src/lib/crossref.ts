// Map a Crossref /works/{doi} message to PaperCards metadata. Pure function (tested).
import type { Author, PaperMeta } from "./types";

type CrossrefDateParts = { "date-parts"?: (number | null)[][] };

export interface CrossrefWork {
  DOI?: string;
  title?: string[];
  subtitle?: string[];
  author?: { family?: string; given?: string; name?: string }[];
  editor?: { family?: string; given?: string; name?: string }[];
  "container-title"?: string[];
  "short-container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  "article-number"?: string;
  publisher?: string;
  URL?: string;
  abstract?: string;
  type?: string;
  issued?: CrossrefDateParts;
  published?: CrossrefDateParts;
  "published-print"?: CrossrefDateParts;
  "published-online"?: CrossrefDateParts;
  created?: CrossrefDateParts;
}

const TYPE_MAP: Record<string, string> = {
  "journal-article": "article",
  "proceedings-article": "conference",
  "book-chapter": "chapter",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  "posted-content": "preprint",
  dissertation: "thesis",
  report: "report",
  dataset: "dataset",
};

function firstYear(...dates: (CrossrefDateParts | undefined)[]): number | null {
  for (const d of dates) {
    const y = d?.["date-parts"]?.[0]?.[0];
    if (typeof y === "number" && y > 1000) return y;
  }
  return null;
}

/** Crossref abstracts are JATS XML ("<jats:p>...</jats:p>"). Reduce to plain text. */
export function stripJats(xml: string | undefined | null): string | null {
  if (!xml) return null;
  const text = xml
    .replace(/<jats:title>\s*Abstract\s*<\/jats:title>/gi, "")
    .replace(/<\/(?:jats:)?p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
  return text || null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function crossrefToMeta(work: CrossrefWork): PaperMeta {
  const people = (work.author && work.author.length ? work.author : work.editor) || [];
  const authors: Author[] = people
    .map((a) => {
      if (a.family) return { family: a.family.trim(), given: a.given?.trim() || undefined };
      if (a.name) return { family: a.name.trim() };
      return null;
    })
    .filter((a): a is Author => Boolean(a && a.family));

  const title = decodeEntities([work.title?.[0], work.subtitle?.[0]].filter(Boolean).join(": "));

  return {
    title: title || "Untitled",
    authors,
    year: firstYear(work.issued, work["published-print"], work["published-online"], work.published, work.created),
    journal: work["container-title"]?.[0] ? decodeEntities(work["container-title"][0]) : null,
    volume: work.volume || null,
    issue: work.issue || null,
    pages: work.page || work["article-number"] || null,
    publisher: work.publisher || null,
    doi: work.DOI ? work.DOI.toLowerCase() : null,
    url: work.URL || (work.DOI ? `https://doi.org/${work.DOI.toLowerCase()}` : null),
    abstract: stripJats(work.abstract),
    item_type: (work.type && TYPE_MAP[work.type]) || "article",
  };
}
