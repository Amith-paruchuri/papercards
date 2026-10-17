"use client";
// "Download card": the paper's notes as a Word document. Word, Pages, LibreOffice and Google Docs all open
// an HTML body saved with the Office namespaces as .doc, so no extra library is needed.
import { formatAuthorsFull } from "./citations";
import { escapeHtml, sanitizeHtml } from "./sanitize";
import { downloadText, slug } from "./download";
import type { NoteSection, Paper, Tag } from "./types";

export function cardWordHtml(paper: Paper, sections: NoteSection[], tags: Tag[]): string {
  const cite = [formatAuthorsFull(paper.authors, 12), paper.year ? `(${paper.year})` : "", paper.journal ? `<i>${escapeHtml(paper.journal)}</i>` : ""]
    .filter(Boolean)
    .map((s, i) => (i === 0 ? escapeHtml(s) : s))
    .join(" ");
  const body = sections
    .map((s) => {
      const html = sanitizeHtml(s.content_html || "").trim();
      const color = s.color || "#2d4f8f";
      return `<h2 style="border-left:4pt solid ${escapeHtml(color)};padding-left:6pt">${escapeHtml(s.title)}</h2>${html || "<p style=\"color:#888\">No notes.</p>"}`;
    })
    .join("\n");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(paper.title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #1a1d24; }
h1 { font-family: Georgia, serif; font-size: 20pt; font-weight: normal; margin: 0 0 4pt; }
h2 { font-size: 12.5pt; margin: 16pt 0 4pt; }
li { margin-bottom: 4pt; }
li em { display: block; color: #555; }
.meta { color: #555; font-size: 10pt; }
.brand { color: #999; font-size: 8pt; margin-top: 24pt; }
</style></head>
<body>
<h1>${escapeHtml(paper.title)}</h1>
<p class="meta">${cite}${paper.doi ? `<br>https://doi.org/${escapeHtml(paper.doi)}` : ""}${tags.length ? `<br>Tags: ${tags.map((t) => escapeHtml(t.name)).join(", ")}` : ""}</p>
${body}
<p class="brand">Made with PaperCards</p>
</body></html>`;
}

export function downloadCardWord(paper: Paper, sections: NoteSection[], tags: Tag[]) {
  downloadText(`${slug(paper.title)}-card.doc`, "﻿" + cardWordHtml(paper, sections, tags), "application/msword");
}
