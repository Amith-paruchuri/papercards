"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Brand } from "./Logo";
import { AddPaperModal } from "./AddPaperModal";
import { errorMessage, useToast } from "./Toast";
import { ThemeSelect } from "./ThemeSelect";
import {
  addPapersToCollection,
  addTagToPapers,
  createCollection,
  deleteCollection,
  deletePaper,
  deleteTag,
  ensureTag,
  listCollections,
  listLibrary,
  listTags,
  renameTag,
  searchPaperIds,
  setStatus,
  updateCollection,
} from "@/lib/data";
import { citationLabel } from "@/lib/citations";
import { exportBibTeX, exportCSV, exportRIS, slug } from "@/lib/download";
import { STATUS_LABELS, STUDY_TYPE_LABELS, type Collection, type LibraryPaper, type PaperStatus, type StudyType, type Tag } from "@/lib/types";

type Sort = "updated" | "added" | "year" | "title" | "priority";
const STATUSES: PaperStatus[] = ["to_read", "reading", "read", "annotated"];

export function LibraryApp() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [papers, setPapers] = useState<LibraryPaper[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scope = params.get("scope") || "all"; // all | unfiled | status:x | col:id | tag:id
  const view = (params.get("view") as "grid" | "list") || "grid";
  const [q, setQ] = useState("");
  const [hitState, setHitState] = useState<{ q: string; ids: Set<string> } | null>(null);
  const hits = q.trim() && hitState?.q === q ? hitState.ids : null;
  const [sort, setSort] = useState<Sort>("updated");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [studyType, setStudyType] = useState<StudyType | "">("");
  const [pdfOnly, setPdfOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<null | { files?: File[] }>(null);
  const [newCol, setNewCol] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [pageDrag, setPageDrag] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "all" || value === "grid") next.delete(key);
      else next.set(key, value);
      const s = next.toString();
      router.replace(s ? `/?${s}` : "/", { scroll: false });
    },
    [params, router]
  );

  const apply = useCallback(([p, c, t]: [LibraryPaper[], Collection[], Tag[]]) => {
    setPapers(p);
    setCollections(c);
    setTags(t);
    setLoadError(null);
  }, []);
  const fail = useCallback((e: unknown) => {
    setLoadError(errorMessage(e));
    setPapers((prev) => prev ?? []);
  }, []);
  const load = useCallback(
    () => Promise.all([listLibrary(), listCollections(), listTags()]).then(apply, fail),
    [apply, fail]
  );

  useEffect(() => {
    let alive = true;
    Promise.all([listLibrary(), listCollections(), listTags()]).then(
      (r) => alive && apply(r),
      (e) => alive && fail(e)
    );
    return () => {
      alive = false;
    };
  }, [apply, fail]);

  // Debounced full-text search on the server.
  useEffect(() => {
    if (!q.trim()) return;
    const h = setTimeout(() => {
      searchPaperIds(q)
        .then((ids) => setHitState({ q, ids }))
        .catch((e) => toast(errorMessage(e), { err: true }));
    }, 220);
    return () => clearTimeout(h);
  }, [q, toast]);

  // Keyboard: "/" focuses search, "n" adds a paper, Esc clears selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey) {
        setAdding({});
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const currentCollection = scope.startsWith("col:") ? collections.find((c) => c.id === scope.slice(4)) ?? null : null;
  const currentTag = scope.startsWith("tag:") ? tagById.get(scope.slice(4)) ?? null : null;

  const counts = useMemo(() => {
    const c = { all: 0, unfiled: 0, status: {} as Record<string, number>, col: {} as Record<string, number>, tag: {} as Record<string, number> };
    for (const p of papers ?? []) {
      c.all++;
      c.status[p.status] = (c.status[p.status] || 0) + 1;
      if (!p.collection_papers.length) c.unfiled++;
      for (const cp of p.collection_papers) c.col[cp.collection_id] = (c.col[cp.collection_id] || 0) + 1;
      for (const pt of p.paper_tags) c.tag[pt.tag_id] = (c.tag[pt.tag_id] || 0) + 1;
    }
    return c;
  }, [papers]);

  const visible = (() => {
    let list = papers ?? [];
    if (scope === "unfiled") list = list.filter((p) => !p.collection_papers.length);
    else if (scope.startsWith("status:")) list = list.filter((p) => p.status === scope.slice(7));
    else if (scope.startsWith("col:")) list = list.filter((p) => p.collection_papers.some((c) => c.collection_id === scope.slice(4)));
    else if (scope.startsWith("tag:")) list = list.filter((p) => p.paper_tags.some((t) => t.tag_id === scope.slice(4)));
    if (hits) list = list.filter((p) => hits.has(p.id));
    const yf = parseInt(yearFrom, 10);
    const yt = parseInt(yearTo, 10);
    if (Number.isFinite(yf)) list = list.filter((p) => (p.year ?? 0) >= yf);
    if (Number.isFinite(yt)) list = list.filter((p) => (p.year ?? 9999) <= yt);
    if (studyType) list = list.filter((p) => p.study_type === studyType);
    if (pdfOnly) list = list.filter((p) => p.pdf_path);
    const sorted = list.slice();
    const by: Record<Sort, (a: LibraryPaper, b: LibraryPaper) => number> = {
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      added: (a, b) => b.created_at.localeCompare(a.created_at),
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
      title: (a, b) => a.title.localeCompare(b.title),
      priority: (a, b) => b.priority - a.priority || (scope === "status:to_read" ? a.created_at.localeCompare(b.created_at) : b.updated_at.localeCompare(a.updated_at)),
    };
    sorted.sort(by[sort]);
    return sorted;
  })();

  const selectedPapers = useMemo(() => (papers ?? []).filter((p) => selected.has(p.id)), [papers, selected]);
  const exportSet = selectedPapers.length ? selectedPapers : visible;
  const scopeTitle =
    scope === "all"
      ? "All papers"
      : scope === "unfiled"
        ? "Unfiled"
        : scope.startsWith("status:")
          ? STATUS_LABELS[scope.slice(7) as PaperStatus]
          : currentCollection?.name ?? (currentTag ? `#${currentTag.name}` : "Library");
  const exportName = slug(scope === "all" ? "papercards-library" : scopeTitle);
  const filtersOn = Boolean(yearFrom || yearTo || studyType || pdfOnly);

  function toggleSelect(id: string, additive: boolean) {
    setSelected((s) => {
      const n = new Set(additive ? s : []);
      if (s.has(id) && additive) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function bulk(fn: () => Promise<void>, msg: string) {
    try {
      await fn();
      toast(msg);
      await load();
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  async function onCreateCollection(name: string) {
    setNewCol(null);
    if (!name.trim()) return;
    try {
      const c = await createCollection(name);
      setCollections((cs) => [...cs, c]);
      setParam("scope", `col:${c.id}`);
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  async function onRenameCollection(c: Collection) {
    const name = prompt("Rename collection", c.name);
    if (!name || name.trim() === c.name) return;
    await bulk(() => updateCollection(c.id, { name: name.trim() }).then(() => undefined), "Collection renamed.");
  }

  async function onDeleteCollection(c: Collection) {
    if (!confirm(`Delete the collection "${c.name}"? Papers stay in your library.`)) return;
    if (scope === `col:${c.id}`) setParam("scope", null);
    await bulk(() => deleteCollection(c.id), "Collection deleted. Papers kept.");
  }

  async function onRenameTag(t: Tag) {
    const name = prompt("Rename tag", t.name);
    if (!name || name.trim() === t.name) return;
    await bulk(() => renameTag(t.id, name), "Tag renamed.");
  }

  async function onDeleteTag(t: Tag) {
    if (!confirm(`Delete the tag "${t.name}" from all papers?`)) return;
    if (scope === `tag:${t.id}`) setParam("scope", null);
    await bulk(() => deleteTag(t.id), "Tag deleted.");
  }

  async function onDeleteSelected() {
    const n = selectedPapers.length;
    if (!confirm(`Delete ${n} paper${n > 1 ? "s" : ""}, including PDFs, notes and highlights? This cannot be undone.`)) return;
    await bulk(async () => {
      for (const p of selectedPapers) await deletePaper(p);
      setSelected(new Set());
    }, `Deleted ${n} paper${n > 1 ? "s" : ""}.`);
  }

  async function onTagSelected() {
    const name = prompt(`Tag ${selectedPapers.length} paper(s) with:`);
    if (!name?.trim()) return;
    await bulk(async () => {
      const tag = await ensureTag(name, tags);
      await addTagToPapers([...selected], tag.id);
    }, "Tagged.");
  }

  async function onCollectionSummary(text: string) {
    if (!currentCollection || text === currentCollection.summary) return;
    try {
      const c = await updateCollection(currentCollection.id, { summary: text });
      setCollections((cs) => cs.map((x) => (x.id === c.id ? c : x)));
      toast("Deck summary saved.");
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  function onDropOnCollection(e: React.DragEvent, collectionId: string) {
    e.preventDefault();
    setDropCol(null);
    const ids = (e.dataTransfer.getData("application/x-papercards-ids") || "").split(",").filter(Boolean);
    if (ids.length) {
      const name = collections.find((c) => c.id === collectionId)?.name ?? "collection";
      void bulk(() => addPapersToCollection(ids, collectionId), `Added ${ids.length} to ${name}.`);
    } else if (e.dataTransfer.files.length) {
      setParam("scope", `col:${collectionId}`);
      setAdding({ files: Array.from(e.dataTransfer.files) });
    }
  }

  const navItem = (key: string, label: React.ReactNode, count: number | undefined, extra?: React.ReactNode, dropId?: string) => (
    <div
      key={key}
      role="button"
      tabIndex={0}
      className={`nav-item${scope === key ? " active" : ""}${dropId && dropCol === dropId ? " drop-target" : ""}`}
      onClick={() => {
        setParam("scope", key);
        setSelected(new Set());
        setSidebarOpen(false);
      }}
      onKeyDown={(e) => e.key === "Enter" && setParam("scope", key)}
      onDragOver={dropId ? (e) => (e.preventDefault(), setDropCol(dropId)) : undefined}
      onDragLeave={dropId ? () => setDropCol(null) : undefined}
      onDrop={dropId ? (e) => onDropOnCollection(e, dropId) : undefined}
    >
      {label}
      <span className="count">{count ?? 0}</span>
      {extra}
    </div>
  );

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setPageDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setPageDrag(false);
      }}
      onDrop={(e) => {
        setPageDrag(false);
        if (e.defaultPrevented) return;
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setAdding({ files: Array.from(e.dataTransfer.files) });
        }
      }}
    >
      <header className="topbar">
        <button className="icon-btn mobile-only" aria-label="Show sidebar" onClick={() => setSidebarOpen((o) => !o)}>
          ☰
        </button>
        <Brand />
        <div className="search-box">
          <span aria-hidden="true" style={{ color: "var(--ink-soft)" }}>
            ⌕
          </span>
          <input ref={searchRef} type="search" placeholder="Search titles, authors, abstracts, journals…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search library" />
          {!q && <kbd className="desktop-only">/</kbd>}
        </div>
        <div className="topbar-actions">
          <div className="menu-wrap">
            <button className="btn ghost small" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              ⇩ Export
            </button>
            {menu && (
              <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <div className="menu-label">
                  {selectedPapers.length ? `${selectedPapers.length} selected` : `${visible.length} shown`}
                </div>
                <button role="menuitem" onClick={() => (exportBibTeX(exportSet, tags, exportName), setMenu(false))}>
                  BibTeX (.bib)
                </button>
                <button role="menuitem" onClick={() => (exportRIS(exportSet, tags, exportName), setMenu(false))}>
                  RIS (.ris) for EndNote, Zotero, Mendeley
                </button>
                <button role="menuitem" onClick={() => (exportCSV(exportSet, tags, collections, exportName), setMenu(false))}>
                  Spreadsheet (.csv, opens in Excel)
                </button>
                <hr />
                <Link href="/import" role="menuitem">
                  Import from the old Paper Cards…
                </Link>
                <hr />
                <form action="/auth/signout" method="post">
                  <button role="menuitem" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
          <ThemeSelect />
          <button className="btn" onClick={() => setAdding({})}>
            + Add papers
          </button>
        </div>
      </header>

      <div className="layout">
        <nav className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Library">
          <h4>Library</h4>
          {navItem("all", <span className="label-text">All papers</span>, counts.all)}
          {STATUSES.map((s) =>
            navItem(
              `status:${s}`,
              <>
                <span className={`dot ${s}`} />
                <span className="label-text">{STATUS_LABELS[s]}</span>
              </>,
              counts.status[s]
            )
          )}
          {navItem("unfiled", <span className="label-text">Unfiled</span>, counts.unfiled)}

          <h4>
            Collections
            <button className="icon-btn" title="New collection" aria-label="New collection" onClick={() => setNewCol("")}>
              +
            </button>
          </h4>
          {collections.map((c) =>
            navItem(
              `col:${c.id}`,
              <span className="label-text">{c.name}</span>,
              counts.col[c.id],
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title="Rename" aria-label={`Rename ${c.name}`} onClick={() => onRenameCollection(c)}>
                  ✎
                </button>
                <button className="icon-btn" title="Delete" aria-label={`Delete ${c.name}`} onClick={() => onDeleteCollection(c)}>
                  ×
                </button>
              </span>,
              c.id
            )
          )}
          {newCol !== null ? (
            <input
              className="inline-input"
              autoFocus
              placeholder="Collection name"
              value={newCol}
              onChange={(e) => setNewCol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateCollection(newCol);
                if (e.key === "Escape") setNewCol(null);
              }}
              onBlur={() => void onCreateCollection(newCol)}
            />
          ) : (
            !collections.length && (
              <button className="add-link" onClick={() => setNewCol("")}>
                + New collection
              </button>
            )
          )}

          {tags.length > 0 && <h4>Tags</h4>}
          {tags.map((t) =>
            navItem(
              `tag:${t.id}`,
              <span className="label-text">#{t.name}</span>,
              counts.tag[t.id],
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title="Rename" aria-label={`Rename tag ${t.name}`} onClick={() => onRenameTag(t)}>
                  ✎
                </button>
                <button className="icon-btn" title="Delete" aria-label={`Delete tag ${t.name}`} onClick={() => onDeleteTag(t)}>
                  ×
                </button>
              </span>
            )
          )}
        </nav>

        <main className="main">
          <div className="toolbar">
            <h1 className="title">{scopeTitle}</h1>
            <span className="meta">
              {papers ? `${visible.length} paper${visible.length === 1 ? "" : "s"}` : "Loading…"}
              {hits ? " matching" : ""}
            </span>
            <span className="spacer" />
            <label className={`chip${yearFrom || yearTo ? " on" : ""}`}>
              Year
              <input inputMode="numeric" placeholder="from" value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Year from" />
              –
              <input inputMode="numeric" placeholder="to" value={yearTo} onChange={(e) => setYearTo(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Year to" />
            </label>
            <label className={`chip${studyType ? " on" : ""}`}>
              <select value={studyType} onChange={(e) => setStudyType(e.target.value as StudyType | "")} aria-label="Study type">
                <option value="">Any study type</option>
                {Object.entries(STUDY_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button className={`chip${pdfOnly ? " on" : ""}`} onClick={() => setPdfOnly((v) => !v)}>
              Has PDF
            </button>
            {filtersOn && (
              <button
                className="chip"
                onClick={() => {
                  setYearFrom("");
                  setYearTo("");
                  setStudyType("");
                  setPdfOnly(false);
                }}
              >
                Clear
              </button>
            )}
            <label className="chip">
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                <option value="updated">Recently edited</option>
                <option value="added">Recently added</option>
                <option value="year">Newest published</option>
                <option value="title">Title A–Z</option>
                <option value="priority">Priority</option>
              </select>
            </label>
            <button className="chip" onClick={() => setParam("view", view === "grid" ? "list" : "grid")} aria-label="Toggle view">
              {view === "grid" ? "☰ List" : "▦ Cards"}
            </button>
          </div>

          {currentCollection && (
            <div className="collection-summary">
              <textarea
                key={currentCollection.id}
                defaultValue={currentCollection.summary}
                placeholder="Deck summary: what ties these papers together, key takeaways, open questions…"
                onBlur={(e) => void onCollectionSummary(e.target.value)}
                aria-label="Deck summary"
              />
            </div>
          )}

          {selected.size > 0 && (
            <div className="selection-bar">
              <strong>{selected.size} selected</strong>
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) void bulk(() => addPapersToCollection([...selected], v), "Added to collection.");
                }}
                aria-label="Add to collection"
              >
                <option value="">Add to collection…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value as PaperStatus;
                  if (v) void bulk(() => setStatus([...selected], v), `Marked ${STATUS_LABELS[v].toLowerCase()}.`);
                }}
                aria-label="Set status"
              >
                <option value="">Set status…</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <button className="btn ghost small" onClick={onTagSelected}>
                # Tag
              </button>
              <button className="btn ghost small" onClick={() => exportBibTeX(selectedPapers, tags, exportName)}>
                BibTeX
              </button>
              <button className="btn ghost small" onClick={() => exportRIS(selectedPapers, tags, exportName)}>
                RIS
              </button>
              <span className="spacer" />
              <button className="btn ghost small" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>
                Select all {visible.length}
              </button>
              <button className="btn danger small" onClick={onDeleteSelected}>
                Delete
              </button>
              <button className="icon-btn" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                ✕
              </button>
            </div>
          )}

          {loadError && (
            <div className="notice" style={{ marginBottom: 14 }}>
              Could not load your library: {loadError}
              {/relation|does not exist|schema cache/i.test(loadError) ? " (has the database migration been applied?)" : ""}
            </div>
          )}

          {papers === null ? (
            <div className="card-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              {papers.length === 0 ? (
                <>
                  Your library is empty. Drop a few PDFs anywhere on this page, or add papers by DOI.
                  <div>
                    <button className="btn" onClick={() => setAdding({})}>
                      + Add your first papers
                    </button>
                  </div>
                </>
              ) : hits || filtersOn ? (
                "Nothing matches. Try a shorter search or clear the filters."
              ) : (
                <>
                  Nothing here yet.
                  {currentCollection && <div className="hint">Drag cards onto this collection in the sidebar, or add papers while it is open.</div>}
                </>
              )}
            </div>
          ) : view === "list" ? (
            <div className="table-wrap">
              <table className="list-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>Title</th>
                    <th>Authors</th>
                    <th>Year</th>
                    <th>Journal</th>
                    <th>Tags</th>
                    <th>PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? toggleSelect(p.id, true) : router.push(`/paper/${p.id}`))} draggable onDragStart={(e) => dragStart(e, p.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id, true)} aria-label={`Select ${p.title}`} />
                      </td>
                      <td>
                        <span className={`dot ${p.status}`} title={STATUS_LABELS[p.status]} /> <span className="t">{p.title}</span>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {citationLabel({ authors: p.authors, year: null }) || "—"}
                      </td>
                      <td className="mono">{p.year ?? ""}</td>
                      <td style={{ fontSize: 12.5 }}>{p.journal ?? ""}</td>
                      <td>
                        {p.paper_tags.slice(0, 3).map((t) => (
                          <span key={t.tag_id} className="tag" style={{ marginRight: 3 }}>
                            {tagById.get(t.tag_id)?.name}
                          </span>
                        ))}
                      </td>
                      <td className="flag">{p.pdf_path ? "⧉" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card-grid">
              {visible.map((p) => (
                <article
                  key={p.id}
                  className={`paper-card${selected.has(p.id) ? " selected" : ""}`}
                  onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? toggleSelect(p.id, true) : router.push(`/paper/${p.id}`))}
                  draggable
                  onDragStart={(e) => dragStart(e, p.id)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && router.push(`/paper/${p.id}`)}
                >
                  <label className="select-box" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id, true)} aria-label={`Select ${p.title}`} />
                  </label>
                  <div className="top">
                    <span className={`dot ${p.status}`} title={STATUS_LABELS[p.status]} style={{ marginTop: 6 }} />
                    <h3>{p.title}</h3>
                  </div>
                  <div className="cite">
                    {[citationLabel(p), p.journal].filter(Boolean).join(" · ") || "Add authors & year"}
                  </div>
                  {p.abstract && <div className="abstract">{p.abstract}</div>}
                  <div className="foot">
                    {p.paper_tags.slice(0, 4).map((t) => (
                      <span key={t.tag_id} className="tag">
                        {tagById.get(t.tag_id)?.name}
                      </span>
                    ))}
                    <span className="spacer" />
                    {p.priority > 0 && <span className="priority">{"★".repeat(p.priority)}</span>}
                    {p.pdf_path && <span className="flag">⧉ PDF</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      </div>

      {pageDrag && !adding && (
        <div className="modal-backdrop" style={{ alignItems: "center", pointerEvents: "none" }}>
          <div className="modal" style={{ textAlign: "center", fontFamily: "var(--font-serif)", fontSize: 18 }}>
            Drop PDFs to add them{currentCollection ? ` to ${currentCollection.name}` : ""}
          </div>
        </div>
      )}

      {adding && (
        <AddPaperModal
          collectionId={currentCollection?.id ?? null}
          collectionName={currentCollection?.name}
          initialFiles={adding.files}
          onClose={() => setAdding(null)}
          onAdded={() => void load()}
        />
      )}
    </div>
  );

  function dragStart(e: React.DragEvent, id: string) {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData("application/x-papercards-ids", ids.join(","));
    e.dataTransfer.effectAllowed = "copy";
  }
}
