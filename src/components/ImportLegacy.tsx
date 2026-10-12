"use client";
import { useState } from "react";
import Link from "next/link";
import { Brand } from "./Logo";
import { errorMessage } from "./Toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  addPapersToCollection,
  addTagToPapers,
  createCollection,
  createHighlight,
  createPaper,
  DuplicateDoiError,
  ensureTag,
  listCollections,
  listSections,
  listTags,
  updateSection,
  uploadPdf,
} from "@/lib/data";
import { dataUrlToBlob, legacyNoteToHtml, parseLegacyExport, toImportCard } from "@/lib/legacy";
import { sanitizeHtml } from "@/lib/sanitize";
import { sha256Hex } from "@/lib/pdf/pdfjs";
import type { Tag } from "@/lib/types";

const SNIPPET = `(()=>{const d=localStorage.getItem('papercards_v1');if(!d){alert('No Paper Cards data in this browser.');return;}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([d],{type:'application/json'}));a.download='papercards-legacy.json';a.click();})()`;

export function ImportLegacy() {
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const say = (line: string) => setLog((l) => [...l, line]);

  async function run(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setLog([]);
    try {
      const state = parseLegacyExport(await file.text());
      const cards = state.cards.map(toImportCard);
      say(`Found ${cards.length} card(s) and ${state.decks.length} deck(s).`);
      setProgress({ done: 0, total: cards.length });

      // Decks -> collections (reuse same-named collections).
      const existingCols = await listCollections();
      const deckMap = new Map<string, string>();
      for (const d of state.decks) {
        const hit = existingCols.find((c) => c.name.trim().toLowerCase() === d.name.trim().toLowerCase());
        const col = hit ?? (await createCollection(d.name));
        deckMap.set(d.id, col.id);
      }

      // Skip cards imported before (idempotent re-runs).
      const { data: already } = await supabaseBrowser().from("papers").select("legacy_id").not("legacy_id", "is", null);
      const seen = new Set((already ?? []).map((r: { legacy_id: string }) => r.legacy_id));

      let tags: Tag[] = await listTags();
      let imported = 0;
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const label = `“${c.title.slice(0, 60)}”`;
        try {
          if (seen.has(c.legacyId)) {
            say(`↷ ${label} was already imported.`);
            continue;
          }
          let paper;
          try {
            paper = await createPaper({ title: c.title, authors: c.authors, year: c.year, journal: c.journal, doi: c.doi, abstract: c.abstract, status: c.status, legacy_id: c.legacyId });
          } catch (e) {
            if (e instanceof DuplicateDoiError) {
              say(`↷ ${label}: a card with DOI ${c.doi} already exists, skipped.`);
              continue;
            }
            throw e;
          }

          const sections = await listSections(paper.id);
          const byTitle = new Map(sections.map((s) => [s.title, s]));
          for (const [title, raw] of Object.entries(c.notes)) {
            const s = byTitle.get(title);
            if (s) await updateSection(s.id, { content_html: sanitizeHtml(legacyNoteToHtml(raw)) });
          }
          for (const h of c.highlights) {
            const s = h.sectionTitle ? byTitle.get(h.sectionTitle) : undefined;
            await createHighlight({ paper_id: paper.id, section_id: s?.id ?? null, page: h.page, text: h.text, color: s?.color ?? null, rects: h.rects });
          }
          for (const name of c.labels) {
            const t = await ensureTag(name, tags);
            if (!tags.some((x) => x.id === t.id)) tags = [...tags, t];
            await addTagToPapers([paper.id], t.id);
          }
          for (const deckId of c.deckIds) {
            const colId = deckMap.get(deckId);
            if (colId) await addPapersToCollection([paper.id], colId);
          }
          if (c.pdfDataUrl) {
            const blob = dataUrlToBlob(c.pdfDataUrl);
            await uploadPdf(paper.id, blob, await sha256Hex(await blob.arrayBuffer()));
          }
          imported++;
          say(`✓ ${label}${c.pdfDataUrl ? " (with PDF)" : ""}${c.highlights.length ? `, ${c.highlights.length} highlight(s)` : ""}`);
        } catch (e) {
          say(`✕ ${label}: ${errorMessage(e)}`);
        } finally {
          setProgress({ done: i + 1, total: cards.length });
        }
      }
      say(`Done. Imported ${imported} card(s).`);
    } catch (e) {
      say(`✕ ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="topbar">
        <Brand />
        <span className="spacer" />
        <Link className="btn ghost small" href="/">
          ← Library
        </Link>
      </header>
      <main className="page-narrow">
        <h1>Import from the old Paper Cards</h1>
        <p className="hint" style={{ fontSize: 14 }}>
          Your old cards live in the browser where you used the single-file version. This brings across titles, notes, highlights, labels, decks and
          stored PDFs. Running it twice is safe; already-imported cards are skipped.
        </p>
        <ol style={{ lineHeight: 1.7, paddingLeft: 20 }}>
          <li>Open the old <code>paper-cards-research.html</code> in the browser you used it in.</li>
          <li>
            Open the browser console (Chrome/Edge: <code>⌥⌘J</code> on Mac, <code>Ctrl+Shift+J</code> on Windows; Safari: <code>⌥⌘C</code>), paste this and press Enter.
            It downloads <code>papercards-legacy.json</code>:
            <div className="code" style={{ marginTop: 6 }}>
              {SNIPPET}
            </div>
            <button
              className="btn ghost small"
              style={{ marginTop: 6 }}
              onClick={() => {
                void navigator.clipboard?.writeText(SNIPPET);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy snippet"}
            </button>
          </li>
          <li>Choose that file here:</li>
        </ol>
        <label className="dropzone">
          <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => void run(e.target.files?.[0])} />
          {busy ? "Importing…" : <strong>Choose papercards-legacy.json</strong>}
        </label>
        {progress && (
          <div className="progress">
            <i style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
          </div>
        )}
        {log.length > 0 && (
          <div className="log" aria-live="polite">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
        {!busy && log.some((l) => l.startsWith("Done")) && (
          <Link className="btn" href="/" style={{ marginTop: 14 }}>
            Open your library
          </Link>
        )}
      </main>
    </div>
  );
}
