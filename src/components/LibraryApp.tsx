"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { nameCard, navigateWithTransition } from "@/lib/motion-fx";
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowsClockwise,
  GraduationCap,
  CaretRight,
  Sparkle,
  Graph,
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
  Kanban,
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
  UserCircle,
  ChatCircleDots,
} from "@phosphor-icons/react";
import { Brand, OrigamiMark } from "./Logo";
import { AddPaperModal } from "./AddPaperModal";
import { PaperCard } from "./PaperCard";
import { SAMPLE_CARDS } from "@/lib/sample-cards";
import { supabaseBrowser } from "@/lib/supabase/client";
import { seedDemoLibrary } from "@/lib/demo";
import { PublicationsModal } from "./PublicationsModal";
import { OrganiseModal } from "./OrganiseModal";
import { AiSettingsModal } from "./AiSettingsModal";
import { errorMessage, useToast } from "./Toast";
import { ThemeSelect } from "./ThemeSelect";
import { COMMAND_EVENT, type Command } from "./CommandPalette";
import {
  addPapersToCollection,
  addTagToPapers,
  createCollection,
  deleteCollection,
  deleteForever,
  getProfile,
  listTrash,
  purgeOldTrash,
  restorePapers,
  setMine,
  trashPapers,
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
import { STATUS_LABELS, STUDY_TYPE_LABELS, TRASH_DAYS, type Collection, type LibraryPaper, type Paper, type PaperStatus, type Profile, type StudyType, type Tag } from "@/lib/types";

type Sort = "updated" | "added" | "year" | "title" | "priority";
const STATUSES: PaperStatus[] = ["to_read", "reading", "read", "annotated"];
const STATUS_ICON: Record<PaperStatus, React.ReactNode> = {
  to_read: <BookmarkSimple size={17} className="nav-icon" />,
  reading: <BookOpen size={17} className="nav-icon" />,
  read: <CheckCircle size={17} className="nav-icon" />,
  annotated: <HighlighterCircle size={17} className="nav-icon" />,
};

export function LibraryApp() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [papers, setPapers] = useState<LibraryPaper[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scope = params.get("scope") || "all"; // all | unfiled | status:x | col:id | tag:id
  const viewParam = params.get("view");
  const view = viewParam === "list" ? "list" : viewParam === "shelf" ? "shelf" : "grid";
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
  const [guest, setGuest] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [trash, setTrash] = useState<Paper[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pubModal, setPubModal] = useState<null | { autoSync?: boolean }>(null);
  const [organising, setOrganising] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [isFeedbackAdmin, setIsFeedbackAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    void supabaseBrowser()
      .rpc("is_feedback_admin")
      .then(({ data }) => live && setIsFeedbackAdmin(data === true));
    return () => {
      live = false;
    };
  }, []);
  // Reading-status rows fold into one expandable row; the choice is remembered on this device.
  const [statusOpen, setStatusOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem("papercards_status_open") === "1") setStatusOpen(true);
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);
  function toggleStatus() {
    setStatusOpen((o) => {
      try {
        localStorage.setItem("papercards_status_open", o ? "0" : "1");
      } catch {}
      return !o;
    });
  }
  const reduceMotion = useReducedMotion();
  // Arriving back from a paper inside a page transition: show cards at once so the morph lands on a visible card.
  const [arrivedViaTransition] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("vt-paper"));
  const [dropStatus, setDropStatus] = useState<PaperStatus | null>(null);
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
  const loadTrash = useCallback(() => listTrash().then(setTrash, () => {}), []);
  const load = useCallback(
    () => Promise.all([Promise.all([listLibrary(), listCollections(), listTags()]).then(apply, fail), loadTrash()]),
    [apply, fail, loadTrash]
  );

  // Trash older than TRASH_DAYS goes for good; then load what's left in Trash, and the profile links.
  useEffect(() => {
    let alive = true;
    purgeOldTrash()
      .catch(() => 0)
      .then(() => listTrash())
      .then((t) => alive && setTrash(t), () => {});
    getProfile().then((p) => alive && setProfile(p), () => {});
    return () => {
      alive = false;
    };
  }, []);

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

  // Guests (anonymous sign-in) get a banner offering to keep their library.
  useEffect(() => {
    let alive = true;
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => alive && setGuest(Boolean(data.user?.is_anonymous)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ?welcome=1 (from "Try it now"): fill an empty library with three classic papers.
  const demoStarted = useRef(false);
  const [welcomeFlag] = useState(() => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem("papercards_welcome") === "1";
    } catch {
      return false;
    }
  });
  const welcome = params.get("welcome") || (welcomeFlag ? "1" : null);
  useEffect(() => {
    if (!welcome || papers === null) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem("papercards_welcome");
      } catch {}
      if (params.get("welcome")) setParam("welcome", null);
      if (papers.length === 0 && !demoStarted.current) {
        demoStarted.current = true;
        void loadDemo();
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome, papers, setParam]);

  async function loadDemo() {
    setSeeding(true);
    try {
      const n = await seedDemoLibrary();
      await load();
      toast(`Added ${n} classic papers to explore. Open one to see its notes.`);
    } catch (e) {
      toast(errorMessage(e), { err: true });
    } finally {
      setSeeding(false);
    }
  }

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
    else if (cmd === "organise") setOrganising(true);
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
    const c = { all: 0, unfiled: 0, mine: 0, status: {} as Record<string, number>, col: {} as Record<string, number>, tag: {} as Record<string, number> };
    for (const p of papers ?? []) {
      c.all++;
      if (p.is_mine) c.mine++;
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
    else if (scope === "mine") list = list.filter((p) => p.is_mine);
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
        ? "Not in a deck"
        : scope === "mine"
          ? "My publications"
          : scope === "trash"
            ? "Trash"
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

  const continuePaper = (papers ?? []).filter((p) => p.status === "reading").sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;

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
    const card = (e.currentTarget as HTMLElement).closest<HTMLElement>(".paper-card");
    if (card) nameCard(card);
    navigateWithTransition(
      () => router.push(`/paper/${id}`),
      // Wait for the title and the notes so both arrive together inside the transition.
      () => Boolean(document.querySelector(".paper-title") && document.querySelector(".notes-col .section-box"))
    );
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
    const name = prompt("Rename deck", c.name);
    if (!name || name.trim() === c.name) return;
    await bulk(() => updateCollection(c.id, { name: name.trim() }).then(() => undefined), "Deck renamed.");
  }

  async function onDeleteCollection(c: Collection) {
    if (!confirm(`Delete the deck “${c.name}”? The papers stay in your library.`)) return;
    if (scope === `col:${c.id}`) setParam("scope", null);
    await bulk(() => deleteCollection(c.id), "Deck deleted. Papers kept.");
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
    const ids = [...selected];
    const n = ids.length;
    try {
      await trashPapers(ids);
      setSelected(new Set());
      await load();
      toast(`Moved ${n} ${n > 1 ? "papers" : "paper"} to Trash. They stay there for ${TRASH_DAYS} days.`, {
        action: { label: "Undo", onClick: () => void restorePapers(ids).then(load) },
      });
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  async function onMarkMine(mine: boolean) {
    const ids = [...selected];
    await bulk(() => setMine(ids, mine), mine ? `Added ${ids.length} to My publications.` : `Removed ${ids.length} from My publications.`);
  }

  async function onRestore(ids: string[]) {
    try {
      await restorePapers(ids);
      await load();
      toast(ids.length === 1 ? "Restored to your library." : `Restored ${ids.length} papers.`);
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
  }

  async function onDeleteForever(list: Paper[]) {
    const n = list.length;
    if (!n) return;
    if (!confirm(n === 1 ? `Delete “${list[0].title}” for good, with its PDF, notes and highlights? This can't be undone.` : `Delete ${n} papers for good, with their PDFs, notes and highlights? This can't be undone.`)) return;
    try {
      await deleteForever(list);
      await loadTrash();
      toast(n === 1 ? "Deleted for good." : `Deleted ${n} papers for good.`);
    } catch (e) {
      toast(errorMessage(e), { err: true });
    }
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
      toast("Deck note saved.");
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

  async function onDropOnStatus(e: React.DragEvent, status: PaperStatus) {
    e.preventDefault();
    setDropStatus(null);
    const ids = (e.dataTransfer.getData("application/x-papercards-ids") || "").split(",").filter(Boolean);
    const moving = ids.filter((id) => papers?.find((p) => p.id === id && p.status !== status));
    if (!moving.length) return;
    // Move the cards right away; the database catches up.
    setPapers((ps) => ps && ps.map((p) => (moving.includes(p.id) ? { ...p, status } : p)));
    try {
      await setStatus(moving, status);
      toast(`${moving.length === 1 ? "Moved" : `Moved ${moving.length} papers`} to ${STATUS_LABELS[status].toLowerCase()}.`);
    } catch (err) {
      toast(errorMessage(err), { err: true });
      void load();
    }
  }

  function dragStart(e: React.DragEvent, id: string) {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData("application/x-papercards-ids", ids.join(","));
    e.dataTransfer.effectAllowed = "copyMove";
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

  const empty = papers !== null && papers.length === 0 && !loadError && scope !== "trash" && scope !== "mine";

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
        <button className="icon-btn mobile-only" aria-label="Show decks and filters" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((o) => !o)}>
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
                <button role="menuitem" onClick={() => (setAiSettings(true), setMenu(false))}>
                  <Sparkle size={16} /> AI settings
                </button>
                <Link href="/account" role="menuitem">
                  <UserCircle size={16} /> Account and password
                </Link>
                <Link href="/feedback?product=papercards" role="menuitem">
                  <ChatCircleDots size={16} /> Share feedback
                </Link>
                {isFeedbackAdmin && (
                  <Link href="/admin/feedback" role="menuitem">
                    <Tray size={16} /> Feedback inbox
                  </Link>
                )}
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
          <Link className="btn ghost small graph-link" href="/graph" title="Research graph: see how your papers and decks connect">
            <Graph size={16} /> <span className="desktop-only">Graph</span>
          </Link>
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
          <div className={`nav-row status-group${scope.startsWith("status:") && !statusOpen ? " active" : ""}`}>
            <button className="nav-item" aria-expanded={statusOpen || scope.startsWith("status:")} aria-controls="status-rows" onClick={toggleStatus}>
              <CaretRight size={13} className="nav-icon caret" />
              <span className="label-text">Reading status</span>
              <span className="status-mini" aria-hidden="true">
                {STATUSES.map((s) => (counts.status[s] ? <i key={s} style={{ background: `var(--st-${s})`, flexGrow: counts.status[s] }} /> : null))}
              </span>
            </button>
          </div>
          {(statusOpen || scope.startsWith("status:")) && (
            <div id="status-rows" className="nav-sub">
              {STATUSES.map((s) => navItem(`status:${s}`, STATUS_ICON[s], STATUS_LABELS[s], counts.status[s]))}
            </div>
          )}
          <div title="Papers you haven't put in any deck yet">
            {navItem("unfiled", <Tray size={17} className="nav-icon" />, "Not in a deck", counts.unfiled)}
          </div>
          {navItem("mine", <GraduationCap size={17} className="nav-icon" />, "My publications", counts.mine)}
          {navItem("trash", <Trash size={17} className="nav-icon" />, "Trash", trash.length)}

          <div className="side-heading">
            Decks
            <button className="icon-btn sm" title="New deck" aria-label="New deck" onClick={() => setNewCol("")}>
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
              aria-label="New deck name"
              placeholder="Deck name…"
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
                <Plus size={14} /> New deck
              </button>
            )
          )}
          {(papers?.length ?? 0) >= 2 && (
            <button className="add-link ai-link" onClick={() => setOrganising(true)}>
              <Sparkle size={14} weight="fill" /> {collections.length ? "Organise with AI" : "Let AI make my decks"}
              {counts.unfiled > 0 && <span className="ai-count tnum">{counts.unfiled} not in a deck</span>}
            </button>
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
          {empty && seeding ? (
            <div className="seeding" aria-busy="true" aria-live="polite">
              <h1 className="lib-title">Setting up your demo library…</h1>
              <p className="lib-summary">Five landmark papers, with notes, tags and decks already filled in.</p>
              <div className="card-grid" style={{ marginTop: 22 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton" style={{ animationDelay: `${i * 0.08}s` }} />
                ))}
              </div>
            </div>
          ) : empty ? (
            <FirstRun
              over={firstDrag}
              onFiles={(files) => setAdding({ files })}
              onDois={() => setAdding({})}
              onSamples={() => void loadDemo()}
              seeding={seeding}
            />
          ) : scope === "trash" ? (
            <TrashView trash={trash} onRestore={(ids) => void onRestore(ids)} onDeleteForever={(list) => void onDeleteForever(list)} />
          ) : (
            <>
              {guest && <GuestBanner />}
              <div className="lib-head">
                <div className="lib-head-text">
                  <h1 className="lib-title">{scopeTitle}</h1>
                  <p className="lib-summary" aria-live="polite">
                    {summary}
                  </p>
                  {scope === "mine" && (
                    <div className="mine-bar">
                      {profile?.orcid && (
                        <a className="chip" href={`https://orcid.org/${profile.orcid}`} target="_blank" rel="noreferrer">
                          ORCID {profile.orcid}
                        </a>
                      )}
                      {profile?.scholar_url && (
                        <a className="chip" href={profile.scholar_url} target="_blank" rel="noreferrer">
                          Google Scholar
                        </a>
                      )}
                      {profile?.researchgate_url && (
                        <a className="chip" href={profile.researchgate_url} target="_blank" rel="noreferrer">
                          ResearchGate
                        </a>
                      )}
                      {(profile?.orcid || profile?.openalex_id) && (
                        <button className="chip" onClick={() => setPubModal({ autoSync: true })}>
                          <ArrowsClockwise size={13} /> Check for new
                        </button>
                      )}
                      <button className="chip on" onClick={() => setPubModal({})}>
                        <GraduationCap size={14} /> {profile?.orcid || profile?.openalex_id || profile?.scholar_url ? "Link or import more" : "Link ORCID, Scholar or ResearchGate"}
                      </button>
                    </div>
                  )}
                  {scope === "all" && papers && papers.length > 0 && (
                    <div className="status-meter" role="group" aria-label="Reading progress">
                      <div className="meter-bar" aria-hidden="true">
                        {STATUSES.map((s) =>
                          counts.status[s] ? (
                            <motion.i
                              key={s}
                              style={{ background: `var(--st-${s})`, flexGrow: counts.status[s] }}
                              initial={reduceMotion ? false : { scaleX: 0 }}
                              animate={{ scaleX: 1 }}
                              transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.1 + STATUSES.indexOf(s) * 0.06 }}
                            />
                          ) : null
                        )}
                      </div>
                      <div className="meter-legend">
                        {STATUSES.map((s) => (
                          <button key={s} type="button" onClick={() => setParam("scope", `status:${s}`)}>
                            <span className="status-swatch" style={{ background: `var(--st-${s})` }} />
                            {STATUS_LABELS[s]} <span className="tnum">{counts.status[s] ?? 0}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {scope === "all" && continuePaper && (
                  <Link href={`/paper/${continuePaper.id}`} className="continue-card">
                    <span className="cc-label">
                      <BookOpen size={14} aria-hidden="true" /> Continue reading
                    </span>
                    <span className="cc-title">{continuePaper.title}</span>
                    <span className="cc-by">
                      {formatAuthorShort(continuePaper.authors)}
                      {continuePaper.year ? `, ${continuePaper.year}` : ""}
                    </span>
                    <ArrowRight className="cc-arrow" size={18} aria-hidden="true" />
                  </Link>
                )}
              </div>

              {currentCollection && (
                <div className="deck-tools">
                  <Link className="chip" href={`/graph?deck=${currentCollection.id}`}>
                    <Graph size={14} /> See this deck as a graph
                  </Link>
                </div>
              )}
              {currentCollection && (
                <div className="deck-summary">
                  <textarea
                    key={currentCollection.id}
                    defaultValue={currentCollection.summary}
                    placeholder="What ties these papers together? Write the takeaway for this deck…"
                    onBlur={(e) => void onCollectionSummary(e.target.value)}
                    aria-label="Deck note"
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
                  <button className={view === "shelf" ? "on" : ""} aria-pressed={view === "shelf"} aria-label="Reading shelf" title="Reading shelf" onClick={() => setParam("view", "shelf")}>
                    <Kanban size={16} />
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
                      if (v) void bulk(() => addPapersToCollection([...selected], v), "Filed in deck.");
                    }}
                    aria-label="Add selected to a deck"
                  >
                    <option value="">Add to deck</option>
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
                  {selectedPapers.every((p) => p.is_mine) ? (
                    <button className="btn ghost small" onClick={() => void onMarkMine(false)}>
                      <GraduationCap size={14} /> Not mine
                    </button>
                  ) : (
                    <button className="btn ghost small" onClick={() => void onMarkMine(true)} title="Add to My publications">
                      <GraduationCap size={14} /> Mine
                    </button>
                  )}
                  <span className="spacer" />
                  <button className="btn ghost small" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>
                    Select all {visible.length}
                  </button>
                  <button className="icon-btn" title="Move to Trash" aria-label="Move selected papers to Trash" onClick={onDeleteSelected}>
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
                      <h2>This deck is empty</h2>
                      Drag cards onto “{currentCollection.name}” in the sidebar, or add papers straight into it.
                      <div>
                        <button className="btn" onClick={() => setAdding({})}>
                          <Plus size={16} weight="bold" /> Add papers here
                        </button>
                      </div>
                    </>
                  ) : scope === "mine" ? (
                    <>
                      <h2>Your publications live here</h2>
                      Link your ORCID, find yourself by name, or bring a Google Scholar or ResearchGate export, and your papers appear as cards you can cite and
                      share. You can also select any card in your library and mark it as yours.
                      <div>
                        <button className="btn" onClick={() => setPubModal({})}>
                          <GraduationCap size={16} /> Find my publications
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
              ) : view === "shelf" ? (
                <LayoutGroup>
                  <div className={`shelf${selected.size ? " selecting" : ""}`}>
                    {STATUSES.map((st) => {
                      const col = visible.filter((p) => p.status === st);
                      return (
                        <section
                          key={st}
                          className={`shelf-col${dropStatus === st ? " over" : ""}`}
                          style={{ "--col": `var(--st-${st})` } as React.CSSProperties}
                          aria-label={`${STATUS_LABELS[st]}, ${col.length} ${col.length === 1 ? "paper" : "papers"}`}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes("application/x-papercards-ids")) {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDropStatus(st);
                            }
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropStatus(null);
                          }}
                          onDrop={(e) => void onDropOnStatus(e, st)}
                        >
                          <header className="shelf-head">
                            <span className="status-swatch" style={{ background: `var(--st-${st})` }} />
                            <h2>{STATUS_LABELS[st]}</h2>
                            <span className="tnum count">{col.length}</span>
                          </header>
                          <div className="shelf-list">
                            {col.map((p) => (
                              <motion.div
                                key={p.id}
                                layoutId={reduceMotion ? undefined : `shelf-${p.id}`}
                                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                              >
                                <PaperCard
                                  compact
                                  paper={p}
                                  tagById={tagById}
                                  selected={selected.has(p.id)}
                                  onOpen={(e) => openPaper(e, p.id)}
                                  onToggle={() => toggleSelect(p.id)}
                                  onDragStart={(e) => dragStart(e, p.id)}
                                />
                              </motion.div>
                            ))}
                            {col.length === 0 && <div className="shelf-empty">Drag a card here to mark it {STATUS_LABELS[st].toLowerCase()}</div>}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </LayoutGroup>
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
                  <AnimatePresence mode="popLayout" initial={!reduceMotion && !arrivedViaTransition}>
                    {visible.map((p, i) => (
                      <motion.div
                        key={p.id}
                        layout={!reduceMotion}
                        initial={{ opacity: 0, y: 16, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                        transition={{ type: "spring", stiffness: 260, damping: 30, delay: Math.min(i, 12) * 0.035 }}
                      >
                        <PaperCard
                          paper={p}
                          tagById={tagById}
                          selected={selected.has(p.id)}
                          onOpen={(e) => openPaper(e, p.id)}
                          onToggle={() => toggleSelect(p.id)}
                          onDragStart={(e) => dragStart(e, p.id)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
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

      {organising && papers && (
        <OrganiseModal
          papers={papers}
          collections={collections}
          tags={tags}
          onClose={() => setOrganising(false)}
          onApplied={(msg, undo) => {
            setOrganising(false);
            void load();
            toast(msg, { action: { label: "Undo", onClick: () => void undo().then(load) }, ms: 9000 });
          }}
        />
      )}

      {aiSettings && (
        <AiSettingsModal
          onClose={() => setAiSettings(false)}
          onDone={(msg) => {
            setAiSettings(false);
            toast(msg);
          }}
        />
      )}

      {pubModal && (
        <PublicationsModal
          profile={profile}
          autoSync={pubModal.autoSync}
          onClose={() => setPubModal(null)}
          onImported={(msg) => {
            setPubModal(null);
            toast(msg);
            void load();
            getProfile().then(setProfile, () => {});
          }}
        />
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

function FirstRun({ over, onFiles, onDois, onSamples, seeding }: { over: boolean; onFiles: (f: File[]) => void; onDois: () => void; onSamples: () => void; seeding: boolean }) {
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
        <button className="btn quiet" onClick={onSamples} disabled={seeding}>
          {seeding ? "Setting up a demo library…" : "Try it with 5 classic papers"}
        </button>
      </div>
    </section>
  );
}

function GuestBanner() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  async function keep(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser(
      { email: email.trim() },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/account?kept=1")}` }
    );
    setBusy(false);
    if (error) toast(`${error.message} Check the address and try again.`, { err: true });
    else {
      toast(`Check ${email.trim()} and open the link to keep this library.`);
      setOpen(false);
    }
  }
  return (
    <div className="guest-banner" role="note">
      <span className="gb-dot" aria-hidden="true" />
      <span className="gb-text">
        <strong>You’re trying PaperCards as a guest.</strong> This library lives only in this browser until you add your email.
      </span>
      {open ? (
        <form className="gb-form" onSubmit={keep}>
          <input type="email" required autoComplete="email" spellCheck={false} placeholder="you@institute.edu…" aria-label="Email to keep this library" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn small" disabled={busy}>
            {busy ? "Sending…" : "Send link"}
          </button>
        </form>
      ) : (
        <button className="btn ghost small" onClick={() => setOpen(true)}>
          Keep this library
        </button>
      )}
    </div>
  );
}

function TrashView({ trash, onRestore, onDeleteForever }: { trash: Paper[]; onRestore: (ids: string[]) => void; onDeleteForever: (list: Paper[]) => void }) {
  const [now] = useState(() => Date.now());
  const daysLeft = (p: Paper) => {
    const gone = new Date(p.deleted_at!).getTime() + TRASH_DAYS * 86400000;
    return Math.max(0, Math.ceil((gone - now) / 86400000));
  };
  return (
    <>
      <div className="lib-head">
        <div className="lib-head-text">
          <h1 className="lib-title">Trash</h1>
          <p className="lib-summary">
            {trash.length
              ? `${trash.length} ${trash.length === 1 ? "paper" : "papers"}. Each is deleted for good ${TRASH_DAYS} days after you moved it here.`
              : `Nothing in Trash. Deleted papers wait here for ${TRASH_DAYS} days, with their notes and PDFs, in case you change your mind.`}
          </p>
        </div>
        {trash.length > 0 && (
          <div className="row">
            <button className="btn ghost" onClick={() => onRestore(trash.map((p) => p.id))}>
              <ArrowCounterClockwise size={15} /> Restore all
            </button>
            <button className="btn danger" onClick={() => onDeleteForever(trash)}>
              <Trash size={15} /> Empty Trash
            </button>
          </div>
        )}
      </div>
      {trash.length > 0 && (
        <div className="table-wrap">
          <table className="list-table trash-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Authors</th>
                <th>Year</th>
                <th>Deleted for good in</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {trash.map((p) => {
                const d = daysLeft(p);
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="t">{p.title}</span>
                      {p.pdf_path && <span className="hint"> with PDF</span>}
                    </td>
                    <td>{formatAuthorShort(p.authors)}</td>
                    <td className="tnum">{p.year ?? ""}</td>
                    <td className={`tnum${d <= 3 ? " soon" : ""}`}>{d === 0 ? "today" : `${d} ${d === 1 ? "day" : "days"}`}</td>
                    <td className="trash-actions">
                      <button className="btn ghost small" onClick={() => onRestore([p.id])}>
                        <ArrowCounterClockwise size={14} /> Restore
                      </button>
                      <button className="icon-btn" title="Delete for good" aria-label={`Delete “${p.title}” for good`} onClick={() => onDeleteForever([p])}>
                        <Trash size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
