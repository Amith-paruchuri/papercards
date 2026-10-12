"use client";
// Pull a DOI and best-guess title/authors/year out of a PDF (ported and extended from the legacy prototype).
import { findDoiInText } from "../doi";
import { parseAuthorList } from "../citations";
import type { Author } from "../types";
import { openPdf } from "./pdfjs";

export interface PdfGuess {
  doi: string | null;
  title: string | null;
  authors: Author[];
  year: number | null;
  numPages: number;
}

interface TextItemLike {
  str: string;
  transform?: number[];
  height?: number;
}

const NOISE = /^(vol\.?\s|volume\s|issn|doi\s*:|www\.|https?:\/\/|©|page\s*\d+|\d+\s*\|\s*p|research article|original article|review article|open access|article$)/i;
const STOP = /^(abstract|keywords|introduction|1\.?\s*introduction|running head|received|accepted|published|correspondence|available online|summary|background)/i;
const AFFIL = /(department|university|institute|college|hospital|school of|faculty|centre|center|laborator|@|\bindia\b|\busa\b|united states|united kingdom)/i;

export async function extractPdfGuess(buf: ArrayBuffer): Promise<PdfGuess> {
  const { doc, destroy } = await openPdf(buf);
  try {
    const pagesToScan = Math.min(doc.numPages, 3);
    let fullText = "";
    let firstPageItems: TextItemLike[] = [];
    for (let i = 1; i <= pagesToScan; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items = (tc.items as TextItemLike[]).filter((it) => typeof it.str === "string");
      if (i === 1) firstPageItems = items;
      fullText += " " + items.map((it) => it.str).join(" ");
    }

    let info: Record<string, unknown> = {};
    try {
      const md = await doc.getMetadata();
      info = (md.info as Record<string, unknown>) || {};
      const xmpDoi = md.metadata?.get?.("prism:doi") || md.metadata?.get?.("dc:identifier");
      if (typeof xmpDoi === "string") fullText = xmpDoi + " " + fullText;
    } catch {
      // metadata is optional
    }

    const doi = findDoiInText(String(info.Subject || "") + " " + fullText);
    const layout = guessFromLayout(firstPageItems);
    const infoTitle = typeof info.Title === "string" ? info.Title.trim() : "";
    const infoAuthor = typeof info.Author === "string" ? info.Author.trim() : "";
    const usefulInfoTitle = infoTitle.length > 15 && !/\.(pdf|docx?|tex)$/i.test(infoTitle) && !/^untitled/i.test(infoTitle);

    return {
      doi,
      title: usefulInfoTitle ? infoTitle : layout.title,
      authors: infoAuthor ? parseAuthorList(infoAuthor) : layout.authors,
      year: yearFromText(fullText),
      numPages: doc.numPages,
    };
  } finally {
    void destroy();
  }
}

function yearFromText(text: string): number | null {
  const now = new Date().getFullYear();
  const m = text.match(/\b(19[7-9]\d|20\d{2})\b/g) || [];
  const y = m.map(Number).find((n) => n >= 1970 && n <= now + 1);
  return y ?? null;
}

function guessFromLayout(rawItems: TextItemLike[]): { title: string | null; authors: Author[] } {
  const items = rawItems
    .filter((it) => it.str.trim())
    .map((it) => ({
      str: it.str,
      h: it.height || (it.transform ? Math.abs(it.transform[3]) : 0),
      x: it.transform ? it.transform[4] : 0,
      y: it.transform ? it.transform[5] : 0,
    }));
  if (!items.length) return { title: null, authors: [] };

  // Group into visual lines by y position (top of page first).
  const lines: { y: number; parts: typeof items; text: string; h: number }[] = [];
  for (const it of items) {
    let line = lines.find((l) => Math.abs(l.y - it.y) < 2.5);
    if (!line) {
      line = { y: it.y, parts: [], text: "", h: 0 };
      lines.push(line);
    }
    line.parts.push(it);
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    l.text = l.parts.map((p) => p.str).join(" ").replace(/\s+/g, " ").trim();
    l.h = Math.max(...l.parts.map((p) => p.h));
  }

  const top = lines.filter((l) => l.text.length > 1 && !NOISE.test(l.text)).slice(0, 25);
  if (!top.length) return { title: null, authors: [] };

  // Title = consecutive run of lines in (near) the largest font.
  const maxH = Math.max(...top.map((l) => l.h));
  const titleLines: string[] = [];
  let idx = 0;
  for (; idx < top.length; idx++) {
    if (top[idx].h >= maxH * 0.9) titleLines.push(top[idx].text);
    else if (titleLines.length) break;
  }
  const title = titleLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 300) || null;

  // Authors = lines right after the title, before affiliations / abstract.
  const authorLines: string[] = [];
  for (let j = idx; j < Math.min(idx + 6, top.length); j++) {
    const t = top[j].text;
    if (STOP.test(t)) break;
    if (AFFIL.test(t)) {
      if (authorLines.length) break;
      continue;
    }
    authorLines.push(t);
    if (authorLines.join(" ").length > 240) break;
  }
  const cleaned = authorLines
    .join(", ")
    .replace(/\S+@\S+/g, "")
    .replace(/[*\d†‡§¶]+/g, "")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s+and\s+/gi, ", ");
  const authors = parseAuthorList(cleaned)
    .filter((a) => a.family.length > 1 && /^[\p{L}'’-]+$/u.test(a.family))
    .slice(0, 30);
  return { title, authors };
}
