"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, CircleNotch, FileArrowUp, Link as LinkIcon, PencilSimple, WarningCircle, ArrowBendUpRight, Circle } from "@phosphor-icons/react";
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
  initialDois,
}: {
  collectionId: string | null;
  collectionName?: string;
  onClose: () => void;
  onAdded: () => void;
  initialFiles?: File[];
  initialDois?: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialDois?.length ? "doi" : "pdf");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [doiText, setDoiText] = useState("");
  const [manual, setManual] = useState({ title: "", authors: "", year: "", journal: "", doi: "" });
  const [error, setError] = useState<string | null>(null);
  const jobCount = useRef(0);

  const update = (i: number, patch: Partial<Job>) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...patch } : j)));

  function describe(r: IngestResult): Partial<Job> {
    if (r.kind === "created") return { state: "done", detail: r.note, paperId: r.paper.id };
    if (r.kind === "attached") return { state: "done", detail: "PDF attached to the card you already had.", paperId: r.paper.id };
    return { state: "skipped", detail: r.note, paperId: r.paperId || undefined };
  }

  async function runJobs<T>(items: T[], label: (t: T) => string, fn: (t: T) => Promise<IngestResult>) {
    setBusy(true);
    setError(null);
    const base = jobCount.current;
    jobCount.current += items.length;
    setJobs((js) => [...js, ...items.map((t) => ({ label: label(t), state: "waiting" as const }))]);
    const ids: string[] = [];
    for (let i = 0; i < items.length; i++) {
      update(base + i, { state: "working" });
      try {
        const d = describe(await fn(items[i]));
        update(base + i, d);
        if (d.paperId && d.state === "done") ids.push(d.paperId);
      } catch (e) {
        update(base + i, { state: "error", detail: errorMessage(e) });
      }
    }
    setBusy(false);
    onAdded();
    if (items.length === 1 && ids.length === 1) {
      router.push(`/paper/${ids[0]}`);
      onClose();
    } else if (ids.length) {
      toast(`Added ${ids.length} paper${ids.length > 1 ? "s" : ""}.`);
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

  useEffect(() => {
    const t = setTimeout(() => {
      if (initialFiles?.length) handleFiles(initialFiles);
      else if (initialDois?.length) void runJobs(initialDois, (d) => d, (d) => ingestDoi(d, collectionId));
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setError("Enter a DOI that starts with 10.");
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

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manual.title.trim()) {
      setError("Add a title to create the card.");
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
    } catch (err) {
      if (err instanceof DuplicateDoiError && err.existingId) {
        const id = err.existingId;
        toast("That DOI is already in your library.", { action: { label: "Open it", onClick: () => router.push(`/paper/${id}`) } });
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const finished = jobs.filter((j) => j.state !== "waiting" && j.state !== "working").length;
  const icon = (s: Job["state"]) =>
    s === "working" ? (
      <CircleNotch size={16} className="spin" />
    ) : s === "done" ? (
      <CheckCircle size={16} weight="fill" className="ok" />
    ) : s === "skipped" ? (
      <ArrowBendUpRight size={16} className="skip" />
    ) : s === "error" ? (
      <WarningCircle size={16} weight="fill" className="bad" />
    ) : (
      <Circle size={16} className="skip" />
    );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <h3 id="add-title">{collectionName ? `Add papers to ${collectionName}` : "Add papers"}</h3>
        <div className="tabs" role="tablist" aria-label="How to add">
          {(
            [
              ["pdf", "PDF files", <FileArrowUp key="i" size={16} />],
              ["doi", "DOIs", <LinkIcon key="i" size={16} />],
              ["manual", "By hand", <PencilSimple key="i" size={16} />],
            ] as [Tab, string, React.ReactNode][]
          ).map(([k, l, ic]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {ic}
              {l}
            </button>
          ))}
        </div>

        {tab === "pdf" && (
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
            <FileArrowUp size={30} weight="light" aria-hidden="true" />
            <strong>Drop PDFs here, or choose files</strong>
            <span className="hint">Add as many as you like. PaperCards reads each DOI and fills in the title, authors and journal.</span>
          </label>
        )}

        {tab === "doi" && (
          <>
            <label className="field-label" htmlFor="dois">
              One DOI or doi.org link per line
            </label>
            <textarea
              id="dois"
              rows={5}
              value={doiText}
              onChange={(e) => setDoiText(e.target.value)}
              placeholder={"10.1038/s41586-021-03819-2\nhttps://doi.org/10.1126/science.1225829"}
              spellCheck={false}
            />
            <div className="modal-actions">
              <button className="btn" onClick={addDois} disabled={busy}>
                Look up and add
              </button>
            </div>
          </>
        )}

        {tab === "manual" && (
          <form onSubmit={addManual}>
            <label className="field-label" htmlFor="m-doi">
              DOI, if it has one
            </label>
            <div className="row">
              <input id="m-doi" className="grow" type="text" spellCheck={false} autoComplete="off" value={manual.doi} onChange={(e) => setManual({ ...manual, doi: e.target.value })} placeholder="10.xxxx/xxxxx…" />
              <button type="button" className="btn ghost" onClick={fillFromDoi} disabled={busy}>
                Fill in from DOI
              </button>
            </div>
            <label className="field-label" htmlFor="m-title">
              Title
            </label>
            <input id="m-title" type="text" autoComplete="off" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            <label className="field-label" htmlFor="m-auth">
              Authors
            </label>
            <input id="m-auth" type="text" autoComplete="off" value={manual.authors} onChange={(e) => setManual({ ...manual, authors: e.target.value })} placeholder="Jane Smith; John Doe…" />
            <div className="grid2">
              <div>
                <label className="field-label" htmlFor="m-year">
                  Year
                </label>
                <input id="m-year" type="number" inputMode="numeric" value={manual.year} onChange={(e) => setManual({ ...manual, year: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="m-journal">
                  Journal
                </label>
                <input id="m-journal" type="text" autoComplete="off" value={manual.journal} onChange={(e) => setManual({ ...manual, journal: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" type="submit" disabled={busy}>
                Create card
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}

        {jobs.length > 0 && (
          <>
            <div className="progress" aria-hidden="true">
              <i style={{ width: `${(finished / jobs.length) * 100}%` }} />
            </div>
            <div className="job-list" aria-live="polite">
              {jobs.map((j, i) => (
                <div className="job" key={i}>
                  {icon(j.state)}
                  <span className="name">{j.label}</span>
                  {j.paperId && (j.state === "done" || j.state === "skipped") ? <a href={`/paper/${j.paperId}`}>Open</a> : <span />}
                  {j.detail && <span className="detail">{j.detail}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {jobs.length && !busy ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
