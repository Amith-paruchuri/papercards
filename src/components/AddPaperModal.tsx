"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ingestDoi, ingestPdf, lookupDoi, type IngestResult } from "@/lib/ingest";
import { createPaper, addPapersToCollection, DuplicateDoiError } from "@/lib/data";
import { parseAuthorList } from "@/lib/citations";
import { normalizeDoi } from "@/lib/doi";
import { errorMessage, useToast } from "./Toast";

type Tab = "pdf" | "doi" | "manual";
type Job = { label: string; state: "waiting" | "working" | "done" | "skipped" | "error"; detail?: string; paperId?: string };

export function AddPaperModal({
  collectionId,
  collectionName,
  onClose,
  onAdded,
  initialFiles,
}: {
  collectionId: string | null;
  collectionName?: string;
  onClose: () => void;
  onAdded: () => void;
  initialFiles?: File[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("pdf");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [doiText, setDoiText] = useState("");
  const [manual, setManual] = useState({ title: "", authors: "", year: "", journal: "", doi: "" });
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const update = (i: number, patch: Partial<Job>) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...patch } : j)));

  function describe(r: IngestResult): Partial<Job> {
    if (r.kind === "created") return { state: "done", detail: r.note ? `Added. ${r.note}` : "Added.", paperId: r.paper.id };
    if (r.kind === "attached") return { state: "done", detail: "PDF attached to the existing card.", paperId: r.paper.id };
    return { state: "skipped", detail: r.note, paperId: r.paperId || undefined };
  }

  async function runJobs<T>(items: T[], label: (t: T) => string, fn: (t: T) => Promise<IngestResult>) {
    setBusy(true);
    setError(null);
    const base = jobs.length;
    setJobs((js) => [...js, ...items.map((t) => ({ label: label(t), state: "waiting" as const }))]);
    const results: (string | undefined)[] = [];
    for (let i = 0; i < items.length; i++) {
      update(base + i, { state: "working" });
      try {
        const r = await fn(items[i]);
        const d = describe(r);
        update(base + i, d);
        results.push(d.paperId);
      } catch (e) {
        update(base + i, { state: "error", detail: errorMessage(e) });
      }
    }
    setBusy(false);
    onAdded();
    const ids = results.filter(Boolean) as string[];
    if (items.length === 1 && ids.length === 1) {
      router.push(`/paper/${ids[0]}`);
      onClose();
    }
  }

  function handleFiles(list: FileList | File[] | null) {
    const files = Array.from(list || []).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) {
      setError("Choose one or more PDF files.");
      return;
    }
    void runJobs(files, (f) => f.name, (f) => ingestPdf(f, collectionId));
  }

  if (initialFiles?.length && !started.current) {
    started.current = true;
    queueMicrotask(() => handleFiles(initialFiles));
  }

  function addDois() {
    const dois = doiText
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!dois.length) {
      setError("Paste at least one DOI.");
      return;
    }
    void runJobs(dois, (d) => d, (d) => ingestDoi(d, collectionId));
    setDoiText("");
  }

  async function fillFromDoi() {
    const doi = normalizeDoi(manual.doi);
    if (!doi) {
      setError("Enter a valid DOI first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const m = await lookupDoi(doi);
      setManual({
        title: m.title,
        authors: m.authors.map((a) => [a.given, a.family].filter(Boolean).join(" ")).join("; "),
        year: m.year ? String(m.year) : "",
        journal: m.journal ?? "",
        doi,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function addManual() {
    if (!manual.title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const year = parseInt(manual.year, 10);
      const paper = await createPaper({
        title: manual.title,
        authors: parseAuthorList(manual.authors),
        year: Number.isFinite(year) ? year : null,
        journal: manual.journal.trim() || null,
        doi: normalizeDoi(manual.doi),
        status: "to_read",
      });
      if (collectionId) await addPapersToCollection([paper.id], collectionId);
      onAdded();
      toast("Card created.");
      router.push(`/paper/${paper.id}`);
      onClose();
    } catch (e) {
      if (e instanceof DuplicateDoiError && e.existingId) {
        toast("That DOI is already in your library.", { action: { label: "Open it", onClick: () => router.push(`/paper/${e.existingId}`) } });
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const doneCount = jobs.filter((j) => j.state === "done").length;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <h3 id="add-title">Add papers{collectionName ? <span className="hint"> to {collectionName}</span> : null}</h3>
        <div className="tabs" role="tablist">
          {(
            [
              ["pdf", "Upload PDFs"],
              ["doi", "By DOI"],
              ["manual", "Manual"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>

        {tab === "pdf" && (
          <>
            <label
              className={`dropzone${over ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                handleFiles(e.dataTransfer.files);
              }}
            >
              <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => handleFiles(e.target.files)} disabled={busy} />
              <strong>Drop PDFs here</strong> or click to choose
              <div className="hint" style={{ marginTop: 6 }}>
                Drop many at once. PaperCards finds each DOI and fills in title, authors, journal and year.
              </div>
            </label>
          </>
        )}

        {tab === "doi" && (
          <>
            <label className="field-label" htmlFor="dois">
              DOIs or doi.org links, one per line
            </label>
            <textarea id="dois" rows={5} value={doiText} onChange={(e) => setDoiText(e.target.value)} placeholder={"10.1038/s41586-020-2649-2\nhttps://doi.org/10.1056/NEJMoa2034577"} />
            <div className="modal-actions">
              <button className="btn" onClick={addDois} disabled={busy}>
                Look up and add
              </button>
            </div>
          </>
        )}

        {tab === "manual" && (
          <>
            <label className="field-label">DOI (optional)</label>
            <div className="row">
              <input className="grow" type="text" value={manual.doi} onChange={(e) => setManual({ ...manual, doi: e.target.value })} placeholder="10.xxxx/xxxxx" />
              <button className="btn ghost small" onClick={fillFromDoi} disabled={busy}>
                Fill from DOI
              </button>
            </div>
            <label className="field-label">Title *</label>
            <input type="text" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            <label className="field-label">Authors</label>
            <input type="text" value={manual.authors} onChange={(e) => setManual({ ...manual, authors: e.target.value })} placeholder="Jane Smith; John Doe" />
            <div className="grid2">
              <div>
                <label className="field-label">Year</label>
                <input type="number" value={manual.year} onChange={(e) => setManual({ ...manual, year: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Journal</label>
                <input type="text" value={manual.journal} onChange={(e) => setManual({ ...manual, journal: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={addManual} disabled={busy}>
                Create card
              </button>
            </div>
          </>
        )}

        {error && <div className="error-text">{error}</div>}

        {jobs.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="progress">
              <i style={{ width: `${(jobs.filter((j) => j.state !== "waiting" && j.state !== "working").length / jobs.length) * 100}%` }} />
            </div>
            <div className="log" aria-live="polite">
              {jobs.map((j, i) => (
                <div key={i}>
                  {j.state === "working" ? "…" : j.state === "done" ? "✓" : j.state === "skipped" ? "↷" : j.state === "error" ? "✕" : "·"} {j.label}
                  {j.detail ? ` — ${j.detail}` : ""}
                  {j.paperId && (j.state === "done" || j.state === "skipped") ? (
                    <>
                      {" "}
                      <a href={`/paper/${j.paperId}`}>open</a>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          {jobs.length > 0 && <span className="hint">{doneCount} added</span>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {jobs.length ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
