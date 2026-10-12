"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PdfViewer, type PdfViewerHandle } from "./PdfViewer";
import { SectionEditor } from "./SectionEditor";
import { errorMessage, useToast } from "./Toast";
import { ThemeSelect } from "./ThemeSelect";
import { OrigamiMark } from "./Logo";
import {
  addPapersToCollection,
  addTagToPapers,
  createHighlight,
  createSection,
  deleteHighlight,
  deletePaper,
  deleteSection,
  downloadPdf,
  DuplicateDoiError,
  ensureTag,
  getPaper,
  listCollections,
  listHighlights,
  listSections,
  listTags,
  removePaperFromCollection,
  removePdf,
  removeTagFromPaper,
  updatePaper,
  updateSection,
  uploadPdf,
} from "@/lib/data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { citationLabel, formatAuthorsFull, parseAuthorList, toBibTeX, toRIS } from "@/lib/citations";
import { downloadText, slug } from "@/lib/download";
import { normalizeDoi } from "@/lib/doi";
import { lookupDoi } from "@/lib/ingest";
import { sha256Hex } from "@/lib/pdf/pdfjs";
import { appendHighlightBullet, htmlToText, removeHighlightBullet, sanitizeHtml } from "@/lib/sanitize";
import {
  STATUS_LABELS,
  STUDY_TYPE_LABELS,
  type Collection,
  type Highlight,
  type HighlightRect,
  type NoteSection,
  type Paper,
  type PaperStatus,
  type StudyType,
  type Tag,
} from "@/lib/types";

type PendingRect = { page: number; text: string; rects: HighlightRect[] };

export function PaperView({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const viewer = useRef<PdfViewerHandle>(null);

  const [paper, setPaper] = useState<Paper | null | undefined>(undefined);
  const [sections, setSections] = useState<NoteSection[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [paperTagIds, setPaperTagIds] = useState<string[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [paperCollectionIds, setPaperCollectionIds] = useState<string[]>([]);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [merged, setMerged] = useState(false);
  const [fullPdf, setFullPdf] = useState(false);
  const [menu, setMenu] = useState(false);
  const sectionsRef = useRef<NoteSection[]>([]);
  sectionsRef.current = sections;
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ---------- load ----------
  const loadAll = useCallback(async () => {
    try {
      const p = await getPaper(id);
      setPaper(p);
      if (!p) return;
      const sb = supabaseBrowser();
      const [secs, hls, allTags, cols, pt, cp] = await Promise.all([
        listSections(id),
        listHighlights(id),
        listTags(),
        listCollections(),
        sb.from("paper_tags").select("tag_id").eq("paper_id", id),
        sb.from("collection_papers").select("collection_id").eq("paper_id", id),
      ]);
      setSections(secs);
      setHighlights(hls);
      setTags(allTags);
      setCollections(cols);
      setPaperTagIds((pt.data ?? []).map((r: { tag_id: string }) => r.tag_id));
      setPaperCollectionIds((cp.data ?? []).map((r: { collection_id: string }) => r.collection_id));
    } catch (e) {
      toast(errorMessage(e), { err: true });
      setPaper(null);
    }
  }, [id, toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!paper?.pdf_path) {
      setPdfData(null);
      return;
    }
    let alive = true;
    setPdfLoading(true);
    downloadPdf(paper.pdf_path)
      .then((buf) => alive && setPdfData(buf))
      .catch((e) => alive && toast(errorMessage(e), { err: true }))
      .finally(() => alive && setPdfLoading(false));
    return () => {
      alive = false;
    };
  }, [paper?.pdf_path, toast]);

  // Flush pending note saves when leaving the page.
  useEffect(() => {
    const timers = saveTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // ---------- paper fields ----------
  const patchPaper = useCallback(
    async (patch: Partial<Paper>, msg?: string) => {
      if (!paper) return;
      setPaper({ ...paper, ...patch });
      try {
        const p = await updatePaper(paper.id, patch);
        setPaper(p);
        if (msg) toast(msg);
      } catch (e) {
        if (e instanceof DuplicateDoiError && e.existingId) {
          toast("Another card already has this DOI.", { err: true, action: { label: "Open it", onClick: () => router.push(`/paper/${e.existingId}`) } });
        } else toast(errorMessage(e), { err: true });
        void loadAll();
      }
    },
    [paper, toast, router, loadAll]
  );

  async function refreshFromDoi() {
    const doi = normalizeDoi(paper?.doi);
    if (!doi) return toast("Add a DOI first.", { err: true });
    try {
      const m = await lookupDoi(doi);
      await patchPaper({ ...m, abstract: m.abstract ?? paper?.abstract ?? null }, "Details updated from DOI.");
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  // ---------- notes ----------
  const scheduleSave = useCallback((sectionId: string, html: string) => {
    setSaving("saving");
    const timers = saveTimers.current;
    clearTimeout(timers.get(sectionId));
    timers.set(
      sectionId,
      setTimeout(async () => {
        timers.delete(sectionId);
        try {
          await updateSection(sectionId, { content_html: html });
          if (!timers.size) setSaving("saved");
        } catch (e) {
          setSaving("idle");
          toast(errorMessage(e), { err: true });
        }
      }, 700)
    );
  }, [toast]);

  const onSectionChange = useCallback(
    (sectionId: string, html: string) => {
      setSections((ss) => ss.map((s) => (s.id === sectionId ? { ...s, content_html: html } : s)));
      scheduleSave(sectionId, html);
    },
    [scheduleSave]
  );

  const setSectionHtmlExternally = useCallback(
    (sectionId: string, html: string) => {
      setSections((ss) => ss.map((s) => (s.id === sectionId ? { ...s, content_html: html } : s)));
      setVersions((v) => ({ ...v, [sectionId]: (v[sectionId] ?? 0) + 1 }));
      scheduleSave(sectionId, html);
    },
    [scheduleSave]
  );

  async function onRenameSection(sectionId: string, title: string) {
    setSections((ss) => ss.map((s) => (s.id === sectionId ? { ...s, title } : s)));
    await updateSection(sectionId, { title }).catch((e) => toast(errorMessage(e), { err: true }));
  }
  async function onColorSection(sectionId: string, color: string) {
    setSections((ss) => ss.map((s) => (s.id === sectionId ? { ...s, color } : s)));
    await updateSection(sectionId, { color }).catch((e) => toast(errorMessage(e), { err: true }));
  }
  async function onDeleteSection(s: NoteSection) {
    if (htmlToText(s.content_html) && !confirm(`Delete the "${s.title}" section and its notes?`)) return;
    setSections((ss) => ss.filter((x) => x.id !== s.id));
    await deleteSection(s.id).catch((e) => toast(errorMessage(e), { err: true }));
  }
  async function onMoveSection(sectionId: string, dir: -1 | 1) {
    const list = [...sections];
    const i = list.findIndex((s) => s.id === sectionId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const renumbered = list.map((s, k) => ({ ...s, position: k }));
    setSections(renumbered);
    await Promise.all([updateSection(renumbered[i].id, { position: i }), updateSection(renumbered[j].id, { position: j })]).catch((e) =>
      toast(errorMessage(e), { err: true })
    );
  }
  async function addSection(title?: string): Promise<NoteSection | null> {
    const name = title ?? prompt("New section name", "Notes");
    if (!name?.trim() || !paper) return null;
    const palette = ["#b59cf0", "#f5a25d", "#9aa3ad", "#5ec4ee", "#7ed67e"];
    try {
      const s = await createSection(paper.id, name.trim(), sections.length, palette[sections.length % palette.length]);
      setSections((ss) => [...ss, s]);
      return s;
    } catch (e) {
      toast(errorMessage(e), { err: true });
      return null;
    }
  }

  // ---------- highlights ----------
  async function onHighlight(h: PendingRect & { sectionId: string | null; color: string }) {
    if (!paper) return;
    try {
      const saved = await createHighlight({ paper_id: paper.id, section_id: h.sectionId, page: h.page, text: h.text, color: h.color, rects: h.rects });
      setHighlights((hs) => [...hs, saved]);
      setUndoStack((u) => [...u, saved.id]);
      if (h.sectionId) {
        const sec = sectionsRef.current.find((s) => s.id === h.sectionId);
        if (sec) setSectionHtmlExternally(sec.id, appendHighlightBullet(sec.content_html, saved.id, h.text));
      }
      if (paper.status === "to_read" || paper.status === "reading") void patchPaper({ status: "annotated" });
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  async function onNewSectionHighlight(h: PendingRect) {
    const s = await addSection();
    if (s) await onHighlight({ ...h, sectionId: s.id, color: s.color || "#f0c463" });
  }

  async function onDeleteHighlight(h: Highlight) {
    setHighlights((hs) => hs.filter((x) => x.id !== h.id));
    setUndoStack((u) => u.filter((x) => x !== h.id));
    if (h.section_id) {
      const sec = sectionsRef.current.find((s) => s.id === h.section_id);
      if (sec) setSectionHtmlExternally(sec.id, removeHighlightBullet(sec.content_html, h.id));
    }
    await deleteHighlight(h.id).catch((e) => toast(errorMessage(e), { err: true }));
  }

  function undo() {
    const last = undoStack[undoStack.length - 1];
    const h = highlights.find((x) => x.id === last);
    if (h) {
      void onDeleteHighlight(h);
      toast("Highlight removed.");
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !t.isContentEditable && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") {
        if (undoStack.length) {
          e.preventDefault();
          undo();
        }
      }
      if (e.key === "Escape") {
        setFullPdf(false);
        setMerged(false);
        setMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const jump = useCallback(
    (highlightId: string) => {
      const h = highlights.find((x) => x.id === highlightId);
      if (h) viewer.current?.jumpTo(h);
      else toast("That highlight was removed.");
    },
    [highlights, toast]
  );

  // ---------- tags & collections ----------
  async function addTag(name: string) {
    if (!paper || !name.trim()) return;
    try {
      const t = await ensureTag(name, tags);
      if (!tags.some((x) => x.id === t.id)) setTags((ts) => [...ts, t].sort((a, b) => a.name.localeCompare(b.name)));
      if (!paperTagIds.includes(t.id)) {
        await addTagToPapers([paper.id], t.id);
        setPaperTagIds((ids) => [...ids, t.id]);
      }
      setTagInput("");
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }
  async function removeTag(tagId: string) {
    if (!paper) return;
    setPaperTagIds((ids) => ids.filter((x) => x !== tagId));
    await removeTagFromPaper(paper.id, tagId).catch((e) => toast(errorMessage(e), { err: true }));
  }
  async function toggleCollection(colId: string, on: boolean) {
    if (!paper) return;
    try {
      if (on) {
        await addPapersToCollection([paper.id], colId);
        setPaperCollectionIds((ids) => [...ids, colId]);
      } else {
        await removePaperFromCollection(paper.id, colId);
        setPaperCollectionIds((ids) => ids.filter((x) => x !== colId));
      }
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  // ---------- pdf file ----------
  async function attachPdf(file: File | undefined) {
    if (!paper || !file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return toast("Please choose a PDF.", { err: true });
    try {
      setPdfLoading(true);
      const buf = await file.arrayBuffer();
      const p = await uploadPdf(paper.id, file, await sha256Hex(buf));
      setPaper(p);
      toast("PDF attached.");
    } catch (e) {
      toast(errorMessage(e), { err: true });
    } finally {
      setPdfLoading(false);
    }
  }

  async function detachPdf() {
    if (!paper?.pdf_path) return;
    if (!confirm("Remove the PDF from this card? Your notes and highlight bullets stay.")) return;
    try {
      setPaper(await removePdf(paper));
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  function downloadOriginal() {
    if (!pdfData || !paper) return;
    const blob = new Blob([pdfData], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(citationLabel(paper) || paper.title)}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function onDeletePaper() {
    if (!paper || !confirm("Delete this card, its PDF, notes and highlights? This cannot be undone.")) return;
    try {
      await deletePaper(paper);
      toast("Card deleted.");
      router.push("/");
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  const paperTags = useMemo(() => tags.filter((t) => paperTagIds.includes(t.id)), [tags, paperTagIds]);

  if (paper === undefined) {
    return <div className="empty">Loading…</div>;
  }
  if (paper === null) {
    return (
      <div className="empty">
        This card doesn&apos;t exist or isn&apos;t yours.
        <div>
          <Link className="btn" href="/">
            Back to library
          </Link>
        </div>
      </div>
    );
  }

  const citable = { ...paper, tags: paperTags.map((t) => t.name) };
  const fileBase = slug(citationLabel(paper) || paper.title);

  return (
    <div>
      <header className="paper-head">
        <div className="crumbs">
          <Link href="/" aria-label="Back to library" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <OrigamiMark size={18} /> Library
          </Link>
          <span>/</span>
          <span>{citationLabel(paper) || "Untitled"}</span>
          <span className="spacer" />
          <span className="saving">{saving === "saving" ? "Saving…" : saving === "saved" ? "All changes saved" : ""}</span>
          <ThemeSelect />
          <div className="menu-wrap">
            <button className="btn ghost small" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              ⇩ Export
            </button>
            {menu && (
              <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <button role="menuitem" onClick={() => (downloadText(`${fileBase}.bib`, toBibTeX(citable) + "\n"), setMenu(false))}>
                  BibTeX (.bib)
                </button>
                <button role="menuitem" onClick={() => (downloadText(`${fileBase}.ris`, toRIS(citable) + "\r\n"), setMenu(false))}>
                  RIS (.ris)
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard?.writeText(toBibTeX(citable));
                    toast("BibTeX copied.");
                    setMenu(false);
                  }}
                >
                  Copy BibTeX
                </button>
                <hr />
                <button role="menuitem" onClick={() => (setMerged(true), setMenu(false))}>
                  Combined summary / print to PDF
                </button>
                {pdfData && (
                  <button role="menuitem" onClick={() => (downloadOriginal(), setMenu(false))}>
                    Download PDF
                  </button>
                )}
                <hr />
                <button role="menuitem" onClick={onDeletePaper} style={{ color: "var(--danger)" }}>
                  Delete card
                </button>
              </div>
            )}
          </div>
        </div>
        <h1
          className="paper-title"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(e) => {
            const t = e.currentTarget.textContent?.trim() || "Untitled";
            if (t !== paper.title) void patchPaper({ title: t });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
        >
          {paper.title}
        </h1>
        <div className="paper-sub">
          <span>{formatAuthorsFull(paper.authors) || "No authors yet"}</span>
          {paper.year && <span>{paper.year}</span>}
          {paper.journal && <span>{paper.journal}</span>}
          {paper.doi && (
            <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">
              doi:{paper.doi}
            </a>
          )}
        </div>
        <div className="paper-controls">
          <select value={paper.status} onChange={(e) => void patchPaper({ status: e.target.value as PaperStatus })} aria-label="Reading status">
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select value={paper.priority} onChange={(e) => void patchPaper({ priority: Number(e.target.value) })} aria-label="Priority">
            <option value={0}>No priority</option>
            <option value={1}>★ Low</option>
            <option value={2}>★★ Medium</option>
            <option value={3}>★★★ High</option>
          </select>
          {paperTags.map((t) => (
            <span key={t.id} className="tag">
              #{t.name}
              <button className="x" aria-label={`Remove tag ${t.name}`} onClick={() => void removeTag(t.id)}>
                ×
              </button>
            </span>
          ))}
          <input
            className="tag-input"
            list="tag-suggestions"
            placeholder="+ tag"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                void addTag(tagInput);
              }
            }}
            aria-label="Add tag"
          />
          <datalist id="tag-suggestions">
            {tags.filter((t) => !paperTagIds.includes(t.id)).map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          <details className="menu-wrap" style={{ display: "inline-block" }}>
            <summary className="btn ghost small" style={{ listStyle: "none" }}>
              ▤ {paperCollectionIds.length ? `${paperCollectionIds.length} collection${paperCollectionIds.length > 1 ? "s" : ""}` : "Add to collection"}
            </summary>
            <div className="menu" style={{ left: 0, right: "auto" }}>
              {collections.length === 0 && <div className="hint" style={{ padding: 8 }}>Create collections from the library sidebar.</div>}
              {collections.map((c) => (
                <label key={c.id} style={{ display: "flex", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13 }}>
                  <input type="checkbox" checked={paperCollectionIds.includes(c.id)} onChange={(e) => void toggleCollection(c.id, e.target.checked)} />
                  {c.name}
                </label>
              ))}
            </div>
          </details>
        </div>
      </header>

      <div className={`paper-body${paper.pdf_path ? "" : " no-pdf"}`}>
        <div className="notes-col">
          <details className="meta-panel">
            <summary>Details & bibliography</summary>
            <MetaForm paper={paper} onSave={(patch) => void patchPaper(patch)} onRefreshDoi={refreshFromDoi} />
          </details>
          {sections.map((s, i) => (
            <SectionEditor
              key={s.id}
              section={s}
              externalVersion={versions[s.id] ?? 0}
              onChange={onSectionChange}
              onRename={onRenameSection}
              onColor={onColorSection}
              onDelete={onDeleteSection}
              onMove={onMoveSection}
              onJump={jump}
              isFirst={i === 0}
              isLast={i === sections.length - 1}
            />
          ))}
          <button className="btn ghost small" onClick={() => void addSection()}>
            + Add section
          </button>
        </div>

        <div className="pdf-col" style={fullPdf ? { position: "fixed", inset: 0, zIndex: 50, height: "100vh" } : undefined}>
          {paper.pdf_path ? (
            pdfData ? (
              <PdfViewer
                ref={viewer}
                data={pdfData}
                highlights={highlights}
                sections={sections}
                onHighlight={onHighlight}
                onNewSectionHighlight={onNewSectionHighlight}
                onDeleteHighlight={onDeleteHighlight}
                onUndo={undo}
                canUndo={undoStack.length > 0}
                toolbarExtra={
                  <>
                    <button onClick={() => setFullPdf((f) => !f)} className={fullPdf ? "on" : ""}>
                      {fullPdf ? "✕ Exit full screen" : "⤢ Full screen"}
                    </button>
                    <label className="btn ghost small" style={{ cursor: "pointer" }} title="Replace PDF">
                      Replace
                      <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void attachPdf(e.target.files?.[0])} />
                    </label>
                    <button onClick={detachPdf} title="Remove PDF">
                      Remove
                    </button>
                  </>
                }
              />
            ) : (
              <div className="pdf-empty">{pdfLoading ? "Loading PDF…" : "PDF unavailable."}</div>
            )
          ) : (
            <div className="pdf-empty">
              <label
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void attachPdf(e.dataTransfer.files[0]);
                }}
              >
                <input type="file" accept="application/pdf,.pdf" onChange={(e) => void attachPdf(e.target.files?.[0])} />
                {pdfLoading ? (
                  "Uploading…"
                ) : (
                  <>
                    <strong>Attach the PDF</strong>
                    <div className="hint" style={{ marginTop: 6 }}>
                      Drop it here or click to choose. Then select text to highlight it into your notes.
                    </div>
                  </>
                )}
              </label>
            </div>
          )}
        </div>
      </div>

      {merged && <MergedView paper={paper} sections={sections} tags={paperTags} onClose={() => setMerged(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function MetaForm({ paper, onSave, onRefreshDoi }: { paper: Paper; onSave: (patch: Partial<Paper>) => void; onRefreshDoi: () => void }) {
  const authorsText = paper.authors.map((a) => [a.given, a.family].filter(Boolean).join(" ")).join("; ");
  const field = (key: keyof Paper, label: string, opts: { type?: string; placeholder?: string } = {}) => (
    <div>
      <label className="field-label">{label}</label>
      <input
        type={opts.type ?? "text"}
        defaultValue={(paper[key] as string | number | null) ?? ""}
        placeholder={opts.placeholder}
        key={`${key}-${paper.updated_at}`}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const value = opts.type === "number" ? (raw ? parseInt(raw, 10) : null) : raw || null;
          if (value !== (paper[key] ?? null)) onSave({ [key]: value } as Partial<Paper>);
        }}
      />
    </div>
  );
  return (
    <div>
      <label className="field-label">Authors</label>
      <input
        type="text"
        defaultValue={authorsText}
        key={`authors-${paper.updated_at}`}
        placeholder="Jane Smith; John Doe"
        onBlur={(e) => e.target.value.trim() !== authorsText && onSave({ authors: parseAuthorList(e.target.value) })}
      />
      <div className="grid3">
        {field("year", "Year", { type: "number" })}
        {field("volume", "Volume")}
        {field("issue", "Issue")}
      </div>
      <div className="grid2">
        {field("journal", "Journal")}
        {field("pages", "Pages")}
      </div>
      <label className="field-label">DOI</label>
      <div className="row">
        <input
          className="grow"
          type="text"
          defaultValue={paper.doi ?? ""}
          key={`doi-${paper.updated_at}`}
          placeholder="10.xxxx/xxxxx"
          onBlur={(e) => {
            const d = e.target.value.trim() ? normalizeDoi(e.target.value) : null;
            if (e.target.value.trim() && !d) return;
            if (d !== paper.doi) onSave({ doi: d });
          }}
        />
        <button className="btn ghost small" onClick={onRefreshDoi} title="Fill title, authors, journal and abstract from the DOI">
          ↻ Fill from DOI
        </button>
      </div>
      {field("url", "URL", { placeholder: "https://…" })}
      <div className="grid2">
        <div>
          <label className="field-label">Study type</label>
          <select value={paper.study_type ?? ""} onChange={(e) => onSave({ study_type: (e.target.value || null) as StudyType | null })}>
            <option value="">Not set</option>
            {Object.entries(STUDY_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {field("site", "Study site / country")}
      </div>
      <label className="field-label">Subjects (comma separated)</label>
      <input
        type="text"
        defaultValue={paper.subjects.join(", ")}
        key={`subjects-${paper.updated_at}`}
        onBlur={(e) => {
          const subjects = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
          if (subjects.join("|") !== paper.subjects.join("|")) onSave({ subjects });
        }}
      />
      <label className="field-label">Abstract</label>
      <textarea
        rows={5}
        defaultValue={paper.abstract ?? ""}
        key={`abstract-${paper.updated_at}`}
        onBlur={(e) => e.target.value.trim() !== (paper.abstract ?? "") && onSave({ abstract: e.target.value.trim() || null })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function MergedView({ paper, sections, tags, onClose }: { paper: Paper; sections: NoteSection[]; tags: Tag[]; onClose: () => void }) {
  const plain = [
    paper.title,
    [formatAuthorsFull(paper.authors, 999), paper.year, paper.journal].filter(Boolean).join(" · "),
    paper.doi ? `doi:${paper.doi}` : "",
    "",
    ...sections.flatMap((s) => [s.title.toUpperCase(), htmlToText(s.content_html) || "(empty)", ""]),
  ].join("\n");
  return (
    <div className="modal-backdrop print-area-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal print-area" style={{ width: "min(820px, 100%)" }} role="dialog" aria-modal="true">
        <div className="row no-print" style={{ marginBottom: 10 }}>
          <span className="hint grow">Combined summary</span>
          <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(plain)}>
            Copy text
          </button>
          <button className="btn small" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="print-brand">
          <OrigamiMark size={20} /> <span className="mono" style={{ fontSize: 10, letterSpacing: "0.08em" }}>PAPERCARDS · RESEARCH SUMMARY</span>
        </div>
        <h2 style={{ font: "700 22px/1.3 var(--font-serif)", margin: "10px 0 4px" }}>{paper.title}</h2>
        <div className="mono hint">
          {[formatAuthorsFull(paper.authors, 12), paper.year, paper.journal].filter(Boolean).join(" · ")}
          {paper.doi ? ` · doi:${paper.doi}` : ""}
        </div>
        {tags.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {tags.map((t) => (
              <span key={t.id} className="tag" style={{ marginRight: 4 }}>
                #{t.name}
              </span>
            ))}
          </div>
        )}
        {sections.map((s) => (
          <section key={s.id} style={{ marginTop: 18 }}>
            <h3 style={{ font: "600 12px var(--font-mono)", letterSpacing: "0.07em", textTransform: "uppercase", color: s.color || "var(--accent)", margin: "0 0 6px", borderBottom: "1px solid var(--rule)", paddingBottom: 4 }}>
              {s.title}
            </h3>
            {htmlToText(s.content_html) ? (
              <div className="rich" style={{ maxHeight: "none", padding: 0 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(s.content_html) }} />
            ) : (
              <div className="hint">No notes.</div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
