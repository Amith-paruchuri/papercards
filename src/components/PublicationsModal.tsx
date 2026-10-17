"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CircleNotch, FileArrowUp, IdentificationBadge, MagnifyingGlass, X } from "@phosphor-icons/react";
import { errorMessage } from "./Toast";
import { updateProfile } from "@/lib/data";
import { formatAuthorShort } from "@/lib/citations";
import { classifyWorks, importWorks, type MatchState } from "@/lib/import-mine";
import { normalizeOrcid, parseBibTeX, type AuthorCandidate, type Work } from "@/lib/publications";
import type { Profile } from "@/lib/types";

type Tab = "orcid" | "name" | "scholar";
type Preview = { works: Work[]; states: MatchState[]; heading: string };

async function api<T>(qs: string): Promise<T> {
  const res = await fetch(`/api/publications?${qs}`);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || "Something went wrong. Try again.");
  return body;
}

export function PublicationsModal({
  profile,
  onClose,
  onImported,
  autoSync,
}: {
  profile: Profile | null;
  onClose: () => void;
  onImported: (summary: string) => void;
  /** Open straight on the preview for the saved ORCID / OpenAlex author ("Check for new"). */
  autoSync?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(profile?.orcid || !profile?.openalex_id ? "orcid" : "name");
  const [orcid, setOrcid] = useState(profile?.orcid ?? "");
  const [nameQ, setNameQ] = useState("");
  const [candidates, setCandidates] = useState<AuthorCandidate[] | null>(null);
  const [scholar, setScholar] = useState(profile?.scholar_url ?? "");
  const [rg, setRg] = useState(profile?.researchgate_url ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function show(works: Work[], heading: string) {
    const states = await classifyWorks(works);
    setPreview({ works, states, heading });
    setPicked(new Set(works.map((_, i) => i).filter((i) => states[i] !== "mine")));
  }

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const fromOrcid = (raw: string) =>
    run("Looking up your ORCID record…", async () => {
      const id = normalizeOrcid(raw);
      if (!id) throw new Error("That isn't a valid ORCID iD. It looks like 0000-0002-1825-0097.");
      const r = await api<{ works: Work[]; name: string | null }>(`source=orcid&id=${id}`);
      await updateProfile({ orcid: id, publications_synced_at: new Date().toISOString() });
      if (!r.works.length) throw new Error("Your ORCID record has no public works yet. Add them on orcid.org, or try Find by name.");
      await show(r.works, `${r.works.length} ${r.works.length === 1 ? "work" : "works"} on ORCID${r.name ? ` for ${r.name}` : ""}`);
    });

  const fromAuthor = (c: Pick<AuthorCandidate, "id" | "name">) =>
    run(`Collecting publications for ${c.name}…`, async () => {
      const r = await api<{ works: Work[] }>(`source=openalex&id=${c.id}`);
      await updateProfile({ openalex_id: c.id, publications_synced_at: new Date().toISOString() });
      if (!r.works.length) throw new Error("No publications found for that author.");
      await show(r.works, `${r.works.length} publications for ${c.name}`);
    });

  // "Check for new": go straight to the saved source. (The timer is cleared on unmount, so a
  // development double-mount still runs it exactly once.)
  useEffect(() => {
    if (!autoSync) return;
    const t = setTimeout(() => {
      if (profile?.orcid) void fromOrcid(profile.orcid);
      else if (profile?.openalex_id) void fromAuthor({ id: profile.openalex_id, name: "you" });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync]);

  async function add() {
    if (!preview) return;
    const works = preview.works.filter((_, i) => picked.has(i));
    setProgress({ done: 0, total: works.length });
    try {
      const r = await importWorks(works, (done, total) => setProgress({ done, total }));
      const parts = [r.added && `added ${r.added}`, r.marked && `marked ${r.marked} already in your library`].filter(Boolean);
      onImported(`My publications: ${parts.join(", ") || "nothing new"}.${r.failed ? ` ${r.failed} could not be added.` : ""}`);
    } catch (e) {
      setError(errorMessage(e));
      setProgress(null);
    }
  }

  const newCount = preview ? preview.states.filter((s, i) => picked.has(i) && s !== "mine").length : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div className="modal pub-modal" role="dialog" aria-modal="true" aria-labelledby="pub-title">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h3 id="pub-title" className="grow">
            {preview ? "Choose your publications" : "Link your publications"}
          </h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose} disabled={Boolean(progress)}>
            <X size={18} />
          </button>
        </div>

        {preview ? (
          <>
            <p className="hint" style={{ marginTop: -6 }}>
              {preview.heading}. Untick anything that isn&apos;t yours. Papers already in your library are marked as yours, not copied.
            </p>
            <div className="pub-list" role="list">
              {preview.works.map((w, i) => {
                const st = preview.states[i];
                return (
                  <label key={i} className={`pub-row${st === "mine" ? " done" : ""}`} role="listitem">
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      disabled={st === "mine" || Boolean(progress)}
                      onChange={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(i)) n.delete(i);
                          else n.add(i);
                          return n;
                        })
                      }
                    />
                    <span className="pub-main">
                      <span className="pub-title">{w.title}</span>
                      <span className="pub-meta">
                        {[formatAuthorShort(w.authors), w.year, w.journal].filter(Boolean).join(", ")}
                        {w.doi ? <span className="mono">, {w.doi}</span> : null}
                      </span>
                    </span>
                    {st !== "new" && <span className="tag">{st === "mine" ? "Already yours" : "In your library"}</span>}
                  </label>
                );
              })}
            </div>
            {progress && (
              <div className="progress">
                <i style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
              </div>
            )}
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button className="btn quiet" onClick={() => setPreview(null)} disabled={Boolean(progress)}>
                <ArrowLeft size={14} /> Back
              </button>
              <span className="spacer" />
              <button className="btn" onClick={() => void add()} disabled={!newCount || Boolean(progress)}>
                {progress ? (
                  <>
                    <CircleNotch size={15} className="spin" /> Adding {progress.done} of {progress.total}…
                  </>
                ) : (
                  `Add ${newCount} to My publications`
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === "orcid"} className={tab === "orcid" ? "on" : ""} onClick={() => setTab("orcid")}>
                <IdentificationBadge size={15} /> ORCID
              </button>
              <button role="tab" aria-selected={tab === "name"} className={tab === "name" ? "on" : ""} onClick={() => setTab("name")}>
                <MagnifyingGlass size={15} /> Find by name
              </button>
              <button role="tab" aria-selected={tab === "scholar"} className={tab === "scholar" ? "on" : ""} onClick={() => setTab("scholar")}>
                <FileArrowUp size={15} /> Google Scholar, ResearchGate
              </button>
            </div>

            {tab === "orcid" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void fromOrcid(orcid);
                }}
              >
                <label className="field-label" htmlFor="orcid">
                  Your ORCID iD
                </label>
                <div className="row">
                  <input
                    id="orcid"
                    className="grow"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0000-0002-1825-0097…"
                    value={orcid}
                    onChange={(e) => setOrcid(e.target.value)}
                  />
                  <button className="btn" disabled={Boolean(busy) || !orcid.trim()}>
                    Find my publications
                  </button>
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  The most reliable source: works you have added to your public ORCID record, with authors and journals filled in from OpenAlex.
                  Use &ldquo;Check for new&rdquo; later to pick up new papers.
                </p>
              </form>
            )}

            {tab === "name" && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("Searching authors…", async () => {
                      const r = await api<{ authors: AuthorCandidate[] }>(`source=authors&q=${encodeURIComponent(nameQ)}`);
                      setCandidates(r.authors);
                    });
                  }}
                >
                  <label className="field-label" htmlFor="author-q">
                    Your name as it appears on papers
                  </label>
                  <div className="row">
                    <input id="author-q" className="grow" type="text" autoComplete="off" placeholder="Jane Q. Researcher…" value={nameQ} onChange={(e) => setNameQ(e.target.value)} />
                    <button className="btn" disabled={Boolean(busy) || nameQ.trim().length < 3}>
                      Search
                    </button>
                  </div>
                </form>
                <p className="hint" style={{ marginTop: 10 }}>
                  Searches OpenAlex, an open index of scholarly papers that covers most of what Google Scholar lists. Pick the profile that matches your institution.
                </p>
                {candidates && (
                  <div className="pub-list" style={{ maxHeight: 260 }}>
                    {candidates.length === 0 && <div className="hint">No authors found. Try a shorter version of your name.</div>}
                    {candidates.map((c) => (
                      <button key={c.id} className="pub-row as-button" onClick={() => void fromAuthor(c)} disabled={Boolean(busy)}>
                        <span className="pub-main">
                          <span className="pub-title" style={{ fontFamily: "var(--font-ui)", fontSize: 14 }}>
                            {c.name}
                          </span>
                          <span className="pub-meta">
                            {[c.institution, `${c.works} ${c.works === 1 ? "work" : "works"}`, c.orcid && `ORCID ${c.orcid}`].filter(Boolean).join(", ")}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "scholar" && (
              <>
                <p className="hint" style={{ marginTop: 0 }}>
                  Google Scholar and ResearchGate don&apos;t let other apps read profiles directly, so bring your list over as a file. It takes a minute:
                </p>
                <ol className="steps" style={{ fontSize: 13.5 }}>
                  <li>
                    <strong>Google Scholar:</strong> open your profile, tick the box at the top of your articles to select all, then <em>Export → BibTeX</em> and save the page.
                  </li>
                  <li>
                    <strong>ResearchGate:</strong> on each publication, <em>Download citation → BibTeX</em>. Or use the ORCID tab if your ORCID is up to date.
                  </li>
                </ol>
                <label className="dropzone" style={{ padding: "22px 16px" }}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".bib,.txt,.bibtex,text/plain,application/x-bibtex"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = "";
                      void run("Reading your file…", async () => {
                        const text = (await Promise.all(files.map((f) => f.text()))).join("\n");
                        const works = parseBibTeX(text);
                        if (!works.length) throw new Error("No BibTeX entries found in that file. Make sure you chose the BibTeX export.");
                        await show(works, `${works.length} ${works.length === 1 ? "entry" : "entries"} in your BibTeX file`);
                      });
                    }}
                  />
                  <FileArrowUp size={24} weight="light" aria-hidden="true" />
                  <strong>Choose a BibTeX file</strong>
                  <span className="hint">Or paste a few entries below</span>
                </label>
                <textarea
                  aria-label="Paste BibTeX"
                  rows={3}
                  placeholder="@article{…}"
                  style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text/plain");
                    void run("Reading BibTeX…", async () => {
                      const works = parseBibTeX(text);
                      if (!works.length) throw new Error("That doesn't look like BibTeX. Entries start with @article{ or similar.");
                      await show(works, `${works.length} pasted ${works.length === 1 ? "entry" : "entries"}`);
                    });
                  }}
                />
                <div className="grid2" style={{ marginTop: 4 }}>
                  <div>
                    <label className="field-label" htmlFor="scholar-url">
                      Google Scholar profile link
                    </label>
                    <input id="scholar-url" type="url" autoComplete="off" placeholder="https://scholar.google.com/citations?user=…" value={scholar} onChange={(e) => setScholar(e.target.value)} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="rg-url">
                      ResearchGate profile link
                    </label>
                    <input id="rg-url" type="url" autoComplete="off" placeholder="https://www.researchgate.net/profile/…" value={rg} onChange={(e) => setRg(e.target.value)} />
                  </div>
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="hint grow">Saved links show on your My publications page.</span>
                  <button
                    className="btn ghost small"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Saving…", async () => {
                        const ok = (u: string, host: RegExp) => !u.trim() || host.test(u.trim());
                        if (!ok(scholar, /^https:\/\/scholar\.google\.[a-z.]+\//i)) throw new Error("The Google Scholar link should start with https://scholar.google.");
                        if (!ok(rg, /^https:\/\/(www\.)?researchgate\.net\//i)) throw new Error("The ResearchGate link should start with https://www.researchgate.net/.");
                        await updateProfile({ scholar_url: scholar.trim() || null, researchgate_url: rg.trim() || null });
                        onImported("Profile links saved.");
                      })
                    }
                  >
                    Save links
                  </button>
                </div>
              </>
            )}

            {busy && (
              <div className="hint" role="status" style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
                <CircleNotch size={15} className="spin" /> {busy}
              </div>
            )}
            {error && (
              <div className="error-text" role="alert">
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
