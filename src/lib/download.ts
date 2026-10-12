"use client";
import { toBibTeXAll, toRISAll, formatAuthorsFull } from "./citations";
import { STATUS_LABELS, STUDY_TYPE_LABELS, type Collection, type LibraryPaper, type Tag } from "./types";

export function downloadText(filename: string, text: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function withTags(papers: LibraryPaper[], tags: Tag[]) {
  const byId = new Map(tags.map((t) => [t.id, t.name]));
  return papers.map((p) => ({ ...p, tags: (p.paper_tags || []).map((pt) => byId.get(pt.tag_id)).filter((x): x is string => Boolean(x)) }));
}

export function exportBibTeX(papers: LibraryPaper[], tags: Tag[], name = "papercards") {
  downloadText(`${name}.bib`, toBibTeXAll(withTags(papers, tags)), "application/x-bibtex;charset=utf-8");
}

export function exportRIS(papers: LibraryPaper[], tags: Tag[], name = "papercards") {
  downloadText(`${name}.ris`, toRISAll(withTags(papers, tags)), "application/x-research-info-systems;charset=utf-8");
}

/** CSV with a BOM so Excel opens UTF-8 (author names with accents) correctly. */
export function exportCSV(papers: LibraryPaper[], tags: Tag[], collections: Collection[], name = "papercards") {
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const colName = new Map(collections.map((c) => [c.id, c.name]));
  const header = ["Title", "Authors", "Year", "Journal", "Volume", "Issue", "Pages", "DOI", "URL", "Status", "Study type", "Site", "Subjects", "Tags", "Collections", "Priority", "Has PDF", "Abstract", "Added"];
  const rows = papers.map((p) => [
    p.title,
    formatAuthorsFull(p.authors, 999),
    p.year ?? "",
    p.journal ?? "",
    p.volume ?? "",
    p.issue ?? "",
    p.pages ?? "",
    p.doi ?? "",
    p.url ?? "",
    STATUS_LABELS[p.status],
    p.study_type ? STUDY_TYPE_LABELS[p.study_type] : "",
    p.site ?? "",
    (p.subjects || []).join("; "),
    (p.paper_tags || []).map((t) => tagName.get(t.tag_id)).filter(Boolean).join("; "),
    (p.collection_papers || []).map((c) => colName.get(c.collection_id)).filter(Boolean).join("; "),
    p.priority,
    p.pdf_path ? "Yes" : "No",
    p.abstract ?? "",
    p.created_at.slice(0, 10),
  ]);
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  downloadText(`${name}.csv`, csv, "text/csv;charset=utf-8");
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "papercards";
}
