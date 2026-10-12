"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowSquareIn,
  BookOpen,
  BookmarkSimple,
  Books,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  FolderSimple,
  Hash,
  HighlighterCircle,
  List,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Rows,
  SignOut,
  SquaresFour,
  Tray,
  Trash,
  X,
  Link as LinkIcon,
} from "@phosphor-icons/react";
import { Brand, OrigamiMark } from "./Logo";
import { AddPaperModal } from "./AddPaperModal";
import { PaperCard } from "./PaperCard";
import { SAMPLE_CARDS } from "@/lib/sample-cards";
import { errorMessage, useToast } from "./Toast";
import { ThemeSelect } from "./ThemeSelect";
import { COMMAND_EVENT, type Command } from "./CommandPalette";
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
import { formatAuthorShort } from "@/lib/citations";
import { exportBibTeX, exportCSV, exportRIS, slug } from "@/lib/download";
import { STATUS_LABELS, STUDY_TYPE_LABELS, type Collection, type LibraryPaper, type PaperStatus, type StudyType, type Tag } from "@/lib/types";

type Sort = "updated" | "added" | "year" | "title" | "priority";
const STATUSES: PaperStatus[] = ["to_read", "reading", "read", "annotated"];
const STATUS_ICON: Record<PaperStatus, React.ReactNode> = {
  to_read: <BookmarkSimple size={17} className="nav-icon" />,
  reading: <BookOpen size={17} className="nav-icon" />,
  read: <CheckCircle size={17} className="nav-icon" />,
  annotated: <HighlighterCircle size={17} className="nav-icon" />,
};
// Three landmark papers for trying PaperCards on an empty library.
const SAMPLE_DOIS = ["10.1038/s41586-021-03819-2", "10.1126/science.1225829", "10.1038/s41591-019-0508-1"];

export function LibraryApp() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [papers, setPapers] = useState<LibraryPaper[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scope = params.get("scope") || "all"; // all | unfiled | status:x | col:id | tag:id
  const view = params.get("view") === "list" ? "list" : "grid";
  const [q, setQ] = useState("");
  const [hitState, setHitState] = useState<{ q: string; ids: Set<string> } | null>(null);
  const hits = q.trim() && hitState?.q === q ? hitState.ids : null;
  const [sort, setSort] = useState<Sort>("updated");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [studyType, setStudyType] = useState<StudyType | "">("");
  const [pdfOnly, setPdfOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<null | { files?: File[]; dois?: string[] }>(null);
  const [newCol, setNewCol] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [pageDrag, setPageDrag] = useState(false);
  const [firstDrag, setFirstDrag] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      next.delete("do");
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
  const load = useCallback(() => Promise.all([listLibrary(), listCollections(), listTags()]).then(apply, fail), [apply, fail]);

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
    }, 200);
    return () => clearTimeout(h);
  }, [q, toast]);

  const papersRef = useRef<LibraryPaper[] | null>(null);
  const tagsRef = useRef<Tag[]>([]);
  useEffect(() => {
    papersRef.current = papers;
    tagsRef.current = tags;
  }, [papers, tags]);

  // Commands from the palette (same page) or ?do= (other pages).
  function runCmd(cmd: Command) {
    if (cmd === "add") setAdding({});
    else if (cmd === "new-collection") setNewCol("");
    else if (cmd === "export-bib" && papersRef.current) exportBibTeX(papersRef.current, tagsRef.current, "papercards-library");
  }
  useEffect(() => {
    const onCmd = (e: Event) => runCmd((e as CustomEvent<Command>).detail);
    window.addEventListener(COMMAND_EVENT, onCmd);
    return () => window.removeEventListener(COMMAND_EVENT, onCmd);
  }, []);
  const pendingDo = params.get("do") as Command | null;
  useEffect(() => {
    if (pendingDo && papers) {
      const t = setTimeout(() => {
        runCmd(pendingDo);
        setParam("do", null);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [pendingDo, papers, setParam]);

  // Keyboard: "/" focuses search, "n" adds papers, Esc clears selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setAdding({});
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setMenu(false);
        setSidebarOpen(false);
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

  const scoped = (() => {
    let list = papers ?? [];
    if (scope === "unfiled") list = list.filter((p) => !p.collection_papers.length);
    else if (scope.startsWith("status:")) list = list.filter((p) => p.status === scope.slice(7));
    else if (scope.startsWith("col:")) list = list.filter((p) => p.collection_papers.some((c) => c.collection_id === scope.slice(4)));
    else if (scope.startsWith("tag:")) list = list.filter((p) => p.paper_tags.some((t) => t.tag_id === scope.slice(4)));
    return list;
  })();

  const visible = (() => {
    let list = scoped;
    if (hits) list = list.filter((p) => hits.has(p.id));
    const yf = parseInt(yearFrom, 10);
    const yt = parseInt(yearTo, 10);
    if (Number.isFinite(yf)) list = list.filter((p) => (p.year ?? 0) >= yf);
    if (Number.isFinite(yt)) list = list.filter((p) => (p.year ?? 9999) <= yt);
    if (studyType) list = list.filter((p) => p.study_type === studyType);
    if (pdfOnly) list = list.filter((p) => p.pdf_path);
    const by: Record<Sort, (a: LibraryPaper, b: LibraryPaper) => number> = {
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      added: (a, b) => b.created_at.localeCompare(a.created_at),
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
      title: (a, b) => a.title.localeCompare(b.title),
      priority: (a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at),
    };
    // The to-read queue defaults to priority order.
    const s = scope === "status:to_read" && sort === "updated" ? "priority" : sort;
    return list.slice().sort(by[s]);
  })();

  const selectedPapers = (papers ?? []).filter((p) => selected.has(p.id));
  const exportSet = selectedPapers.length ? selectedPapers : visible;
  const scopeTitle =
    scope === "all"
      ? "Library"
      : scope === "unfiled"
        ? "Unfiled"
        : scope.startsWith("status:")
          ? STATUS_LABELS[scope.slice(7) as PaperStatus]
          : currentCollection?.name ?? (currentTag ? currentTag.name : "Library");
  const exportName = slug(scope === "all" ? "papercards-library" : scopeTitle);
  const filtersOn = Boolean(yearFrom || yearTo || studyType || pdfOnly);

  const summary = (() => {
    if (!papers) return "Loading your papers…";
    if (hits || filtersOn) return `${visible.length} of ${scoped.length} ${scoped.length === 1 ? "paper" : "papers"} match.`;
    const n = scoped.length;
    if (n === 0) return "";
    const toRead = scoped.filter((p) => p.status === "to_read").length;
    const annotated = scoped.filter((p) => p.status === "annotated").length;
    const parts = [`${n} ${n === 1 ? "paper" : "papers"}`];
    if (toRead) parts.push(`${toRead} waiting to be read`);
    if (annotated) parts.push(`${annotated} annotated`);
    return parts.length === 3 ? `${parts[0]}, ${parts[1]} and ${parts[2]}.` : `${parts.join(" and ")}.`;
  })();

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function openPaper(e: React.MouseEvent | React.KeyboardEvent, id: string) {
    if ("metaKey" in e && (e.metaKey || e.ctrlKey || e.shiftKey)) return toggleSelect(id);
    router.push(`/paper/${id}`);
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
      toast(`Created ${c.name}. Drag cards onto it to file them.`);
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
    if (!confirm(`Delete the collection “${c.name}”? The papers stay in your library.`)) return;
    if (scope === `col:${c.id}`) setParam("scope", null);
    await bulk(() => deleteCollection(c.id), "Collection deleted. Papers kept.");
  }

  async function onRenameTag(t: Tag) {
    const name = prompt("Rename tag", t.name);
    if (!name || name.trim() === t.name) return;
    await bulk(() => renameTag(t.id, name), "Tag renamed.");
  }

  async function onDeleteTag(t: Tag) {
    if (!confirm(`Remove the tag “${t.name}” from every paper?`)) return;
    if (scope === `tag:${t.id}`) setParam("scope", null);
    await bulk(() => deleteTag(t.id), "Tag deleted.");
  }

  async function onDeleteSelected() {
    const n = selectedPapers.length;
    if (!confirm(`Delete ${n} ${n > 1 ? "papers" : "paper"} with their PDFs, notes and highlights? This can't be undone.`)) return;
    await bulk(async () => {
      for (const p of selectedPapers) await deletePaper(p);
      setSelected(new Set());
    }, `Deleted ${n} ${n > 1 ? "papers" : "paper"}.`);
  }

  async function onTagSelected() {
    const name = prompt(`Tag ${selectedPapers.length} ${selectedPapers.length > 1 ? "papers" : "paper"} with:`);
    if (!name?.trim()) return;
    await bulk(async () => {
      const tag = await ensureTag(name, tags);
      await addTagToPapers([...selected], tag.id);
    }, `Tagged with ${name.trim()}.`);
  }

  async function onCollectionSummary(text: string) {
    if (!currentCollection || text === currentCollection.summary) return;
    try {
      const c = await updateCollection(currentCollection.id, { summary: text });
      setCollections((cs) => cs.map((x) => (x.id === c.id ? c : x)));
      toast("Collection note saved.");
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
      void bulk(() => addPapersToCollection(ids, collectionId), `Filed ${ids.length} in ${name}.`);
    } else if (e.dataTransfer.files.length) {
      setParam("scope", `col:${collectionId}`);
      setAdding({ files: Array.from(e.dataTransfer.files) });
    }
  }

  function dragStart(e: React.DragEvent, id: string) {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData("application/x-papercards-ids", ids.join(","));
    e.dataTransfer.effectAllowed = "copy";
  }

  const navItem = (key: string, icon: React.ReactNode, label: string, count: number | undefined, actions?: React.ReactNode, dropId?: string) => (
    <div
      key={key}
      className={`nav-row${scope === key ? " active" : ""}${dropId && dropCol === dropId ? " drop-target" : ""}`}
      onDragOver={dropId ? (e) => (e.preventDefault(), setDropCol(dropId)) : undefined}
      onDragLeave={dropId ? () => setDropCol(null) : undefined}
      onDrop={dropId ? (e) => onDropOnCollection(e, dropId) : undefined}
    >
      <button
        className="nav-item"
        aria-current={scope === key ? "page" : undefined}
        onClick={() => {
          setParam("scope", key);
          setSelected(new Set());
          setSidebarOpen(false);
        }}
      >
        {icon}
        <span className="label-text">{label}</span>
        <span className="count">{count ?? 0}</span>
      </button>
      {actions && <span className="row-actions">{actions}</span>}
    </div>
  );

  const empty = papers !== null && papers.length === 0 && !loadError;

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          if (empty) setFirstDrag(true);
          else setPageDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) {
          setPageDrag(false);
          setFirstDrag(false);
        }
      }}
      onDrop={(e) => {
        setPageDrag(false);
        setFirstDrag(false);
        if (e.defaultPrevented) return;
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setAdding({ files: Array.from(e.dataTransfer.files) });
        }
      }}
    >
      <header className="topbar">
        <button className="icon-btn mobile-only" aria-label="Show collections and filters" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((o) => !o)}>
          <List size={20} />
        </button>
        <Brand />
        <div className="search-box">
          <MagnifyingGlass size={16} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            name="q"
            autoComplete="off"
            placeholder="Search titles, authors and abstracts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search your library"
          />
          {q ? (
            <button className="icon-btn sm" aria-label="Clear search" onClick={() => setQ("")}>
              <X size={14} />
            </button>
          ) : (
            <kbd className="desktop-only" aria-hidden="true">
              /
            </kbd>
          )}
        </div>
        <div className="topbar-actions">
          <button className="btn quiet small desktop-only" onClick={() => window.dispatchEvent(new Event("papercards:palette"))} aria-label="Open command menu">
            <kbd>⌘&nbsp;K</kbd>
          </button>
          <div className="menu-wrap">
            <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Export and account" title="Export and account">
              <DownloadSimple size={18} />
            </button>
            {menu && (
              <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <div className="menu-note">
                  Export {selectedPapers.length ? `${selectedPapers.length} selected` : `${visible.length} shown`} {exportSet.length === 1 ? "paper" : "papers"}
                </div>
                <button role="menuitem" onClick={() => (exportBibTeX(exportSet, tags, exportName), setMenu(false))}>
                  <DownloadSimple size={16} /> BibTeX for LaTeX and Overleaf
                </button>
                <button role="menuitem" onClick={() => (exportRIS(exportSet, tags, exportName), setMenu(false))}>
                  <DownloadSimple size={16} /> RIS for EndNote, Zotero, Mendeley
                </button>
                <button role="menuitem" onClick={() => (exportCSV(exportSet, tags, collections, exportName), setMenu(false))}>
                  <DownloadSimple size={16} /> Spreadsheet for Excel
                </button>
                <hr />
                <Link href="/import" role="menuitem">
                  <ArrowSquareIn size={16} /> Import from the old Paper Cards
                </Link>
                <form action="/auth/signout" method="post">
                  <button role="menuitem" type="submit">
                    <SignOut size={16} /> Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
          <ThemeSelect />
          <button className="btn" onClick={() => setAdding({})}>
            <Plus size={16} weight="bold" />
            <span className="desktop-only">Add papers</span>
          </button>
        </div>
      </header>

      <div className="layout">
        <nav className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Library sections">
          <div className="side-heading">Library</div>
          {navItem("all", <Books size={17} className="nav-icon" />, "All papers", counts.all)}
          {STATUSES.map((s) => navItem(`status:${s}`, STATUS_ICON[s], STATUS_LABELS[s], counts.status[s]))}
          {navItem("unfiled", <Tray size={17} className="nav-icon" />, "Unfiled", counts.unfiled)}

          <div className="side-heading">
            Collections
            <button className="icon-btn sm" title="New collection" aria-label="New collection" onClick={() => setNewCol("")}>
              <Plus size={14} />
            </button>
          </div>
          {collections.map((c) =>
            navItem(
              `col:${c.id}`,
              <FolderSimple size={17} className="nav-icon" />,
              c.name,
              counts.col[c.id],
              <>
                <button className="icon-btn sm" title="Rename" aria-label={`Rename ${c.name}`} onClick={() => onRenameCollection(c)}>
                  <PencilSimple size={14} />
                </button>
                <button className="icon-btn sm" title="Delete" aria-label={`Delete ${c.name}`} onClick={() => onDeleteCollection(c)}>
                  <Trash size={14} />
                </button>
              </>,
              c.id
            )
          )}
          {newCol !== null ? (
            <input
              className="inline-input"
              autoFocus
              aria-label="New collection name"
              placeholder="Collection name…"
              value={newCol}
              onChange={(e) => setNewCol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateCollection(newCol);
                if (e.key === "Escape") setNewCol(null);
              }}
              onBlur={() => void onCreateCollection(newCol)}
            />
          ) : (
            collections.length === 0 && (
              <button className="add-link" onClick={() => setNewCol("")}>
                <Plus size={14} /> New collection
              </button>
            )
          )}

          {tags.length > 0 && <div className="side-heading">Tags</div>}
          {tags.map((t) =>
            navItem(
              `tag:${t.id}`,
              <Hash size={17} className="nav-icon" />,
              t.name,
              counts.tag[t.id],
              <>
                <button className="icon-btn sm" title="Rename" aria-label={`Rename tag ${t.name}`} onClick={() => onRenameTag(t)}>
                  <PencilSimple size={14} />
                </button>
                <button className="icon-btn sm" title="Delete" aria-label={`Delete tag ${t.name}`} onClick={() => onDeleteTag(t)}>
                  <Trash size={14} />
                </button>
              </>
            )
          )}
        </nav>

        <main className="main" id="main">
          {empty ? (
            <FirstRun
              over={firstDrag}
              onFiles={(files) => setAdding({ files })}
              onDois={() => setAdding({})}
              onSamples={() => setAdding({ dois: SAMPLE_DOIS })}
            />
          ) : (
            <>
              <div className="lib-head">
                <div>
                  <h1 className="lib-title">{scopeTitle}</h1>
                  <p className="lib-summary" aria-live="polite">
                    {summary}
                  </p>
                </div>
              </div>

              {currentCollection && (
                <div className="deck-summary">
                  <textarea
                    key={currentCollection.id}
                    defaultValue={currentCollection.summary}
                    placeholder="What ties these papers together? Write the takeaway for this collection…"
                    onBlur={(e) => void onCollectionSummary(e.target.value)}
                    aria-label="Collection note"
                    rows={2}
                  />
                </div>
              )}

              <div className="filters" role="group" aria-label="Filter and sort">
                <label className={`chip${yearFrom || yearTo ? " on" : ""}`}>
                  Year
                  <input inputMode="numeric" placeholder="from" value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Published from year" />
                  to
                  <input inputMode="numeric" placeholder="now" value={yearTo} onChange={(e) => setYearTo(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Published up to year" />
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
                <button className={`chip${pdfOnly ? " on" : ""}`} aria-pressed={pdfOnly} onClick={() => setPdfOnly((v) => !v)}>
                  With PDF
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
                    <X size={12} /> Clear filters
                  </button>
                )}
                <span className="spacer" />
                <label className="chip">
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
                    <option value="updated">{scope === "status:to_read" ? "Priority first" : "Recently edited"}</option>
                    <option value="added">Recently added</option>
                    <option value="year">Newest published</option>
                    <option value="title">Title</option>
                    <option value="priority">Priority</option>
                  </select>
                </label>
                <div className="segmented" role="group" aria-label="Layout">
                  <button className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} aria-label="Cards" onClick={() => setParam("view", null)}>
                    <SquaresFour size={16} />
                  </button>
                  <button className={view === "list" ? "on" : ""} aria-pressed={view === "list"} aria-label="List" onClick={() => setParam("view", "list")}>
                    <Rows size={16} />
                  </button>
                </div>
              </div>

              {selected.size > 0 && (
                <div className="selection-bar" role="region" aria-label="Selected papers">
                  <strong>{selected.size} selected</strong>
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) void bulk(() => addPapersToCollection([...selected], v), "Filed in collection.");
                    }}
                    aria-label="Add selected to a collection"
                  >
                    <option value="">Add to collection</option>
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
                      if (v) void bulk(() => setStatus([...selected], v), `Marked as ${STATUS_LABELS[v].toLowerCase()}.`);
                    }}
                    aria-label="Set status of selected"
                  >
                    <option value="">Set status</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <button className="btn ghost small" onClick={onTagSelected}>
                    <Hash size={14} /> Tag
                  </button>
                  <button className="btn ghost small" onClick={() => exportBibTeX(selectedPapers, tags, exportName)}>
                    BibTeX
                  </button>
                  <span className="spacer" />
                  <button className="btn ghost small" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>
                    Select all {visible.length}
                  </button>
                  <button className="icon-btn" title="Delete selected" aria-label="Delete selected papers" onClick={onDeleteSelected}>
                    <Trash size={17} />
                  </button>
                  <button className="icon-btn" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                    <X size={17} />
                  </button>
                </div>
              )}

              {loadError && (
                <div className="notice" role="alert" style={{ marginBottom: 16 }}>
                  <strong>Your library didn&apos;t load.</strong> {loadError}
                  {/relation|does not exist|schema cache/i.test(loadError) ? " Apply the database migration in Supabase, then reload." : " Check your connection and reload."}
                </div>
              )}

              {papers === null ? (
                <div className="card-grid" aria-busy="true">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="skeleton" />
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <div className="empty">
                  {hits || filtersOn ? (
                    <>
                      <h2>Nothing matches</h2>
                      Try fewer words, or clear the filters.
                    </>
                  ) : currentCollection ? (
                    <>
                      <h2>This collection is empty</h2>
                      Drag cards onto “{currentCollection.name}” in the sidebar, or add papers straight into it.
                      <div>
                        <button className="btn" onClick={() => setAdding({})}>
                          <Plus size={16} weight="bold" /> Add papers here
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2>Nothing here yet</h2>
                      Papers you mark this way show up here.
                    </>
                  )}
                </div>
              ) : view === "list" ? (
                <div className="table-wrap">
                  <table className="list-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <span className="sr-only">Select</span>
                        </th>
                        <th>Title</th>
                        <th>Authors</th>
                        <th>Year</th>
                        <th>Journal</th>
                        <th>Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((p) => (
                        <tr key={p.id} onClick={(e) => openPaper(e, p.id)} draggable onDragStart={(e) => dragStart(e, p.id)}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Select “${p.title}”`} />
                          </td>
                          <td>
                            <span className="status-swatch" style={{ background: `var(--st-${p.status})` }} title={STATUS_LABELS[p.status]} />
                            <Link href={`/paper/${p.id}`} className="t" style={{ textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>
                              {p.title}
                            </Link>
                          </td>
                          <td>{formatAuthorShort(p.authors)}</td>
                          <td className="tnum">{p.year ?? ""}</td>
                          <td>
                            <em className="serif">{p.journal ?? ""}</em>
                          </td>
                          <td>
                            {p.paper_tags.slice(0, 3).map((t) => (
                              <span key={t.tag_id} className="tag" style={{ marginRight: 4 }}>
                                {tagById.get(t.tag_id)?.name}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={`card-grid${selected.size ? " selecting" : ""}`}>
                  {visible.map((p) => (
                    <PaperCard
                      key={p.id}
                      paper={p}
                      tagById={tagById}
                      selected={selected.has(p.id)}
                      onOpen={(e) => openPaper(e, p.id)}
                      onToggle={() => toggleSelect(p.id)}
                      onDragStart={(e) => dragStart(e, p.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {pageDrag && !adding && (
        <div className="modal-backdrop" style={{ alignItems: "center", pointerEvents: "none" }}>
          <div className="modal" style={{ textAlign: "center", width: "auto", padding: "26px 34px" }}>
            <FileArrowUp size={30} weight="light" />
            <div style={{ font: "500 22px/1.3 var(--font-serif)", marginTop: 8 }}>Drop to add{currentCollection ? ` to ${currentCollection.name}` : " to your library"}</div>
          </div>
        </div>
      )}

      {adding && (
        <AddPaperModal
          collectionId={currentCollection?.id ?? null}
          collectionName={currentCollection?.name}
          initialFiles={adding.files}
          initialDois={adding.dois}
          onClose={() => setAdding(null)}
          onAdded={() => void load()}
        />
      )}
    </div>
  );
}

function FirstRun({ over, onFiles, onDois, onSamples }: { over: boolean; onFiles: (f: File[]) => void; onDois: () => void; onSamples: () => void }) {
  return (
    <section className="first-run" aria-labelledby="first-run-title">
      <div className="card-stack centered" aria-hidden="true">
        {SAMPLE_CARDS.map((p) => (
          <PaperCard key={p.id} paper={p} static />
        ))}
      </div>
      <span className="first-run-mark">
        <OrigamiMark size={56} />
      </span>
      <h2 id="first-run-title">Start your research library</h2>
      <p>Drop in the PDFs you&apos;re reading. PaperCards finds each DOI, fills in the citation, and gives every paper a card for your notes.</p>
      <label className={`drop-panel${over ? " over" : ""}`}>
        <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => onFiles(Array.from(e.target.files || []))} />
        <FileArrowUp size={36} weight="light" aria-hidden="true" />
        <strong>Drop PDFs anywhere on this page</strong>
        <span className="btn">Choose PDF files</span>
      </label>
      <div className="alt-actions">
        <button className="btn ghost" onClick={onDois}>
          <LinkIcon size={16} /> Paste DOIs
        </button>
        <Link className="btn ghost" href="/import">
          <ArrowSquareIn size={16} /> Import old Paper Cards
        </Link>
        <button className="btn quiet" onClick={onSamples}>
          Try it with 3 classic papers
        </button>
      </div>
    </section>
  );
}
