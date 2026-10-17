"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowSquareIn,
  BookOpenText,
  DownloadSimple,
  FilePlus,
  FolderSimple,
  FolderSimplePlus,
  MagnifyingGlass,
  MoonStars, Graph } from "@phosphor-icons/react";
import { listCollections, listLibrary } from "@/lib/data";
import { formatAuthorShort } from "@/lib/citations";
import { applyTheme, nextTheme, readTheme } from "@/lib/theme";
import type { Collection, LibraryPaper } from "@/lib/types";

export const COMMAND_EVENT = "papercards:command";
export type Command = "add" | "new-collection" | "export-bib";

export function runCommand(cmd: Command) {
  window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: cmd }));
}

type Item = { id: string; group: string; label: string; sub?: string; icon: React.ReactNode; serif?: boolean; run: () => void };

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [papers, setPapers] = useState<LibraryPaper[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = pathname !== "/login" && !pathname.startsWith("/auth");

  const show = useCallback(() => {
    setQ("");
    setActive(0);
    setOpen(true);
    Promise.all([listLibrary(), listCollections()])
      .then(([p, c]) => {
        setPapers(p);
        setCollections(c);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
      }
    };
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener("papercards:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("papercards:palette", onOpen);
    };
  }, [enabled, open, show]);

  const go = useCallback(
    (cmd: Command) => {
      setOpen(false);
      if (pathname === "/") runCommand(cmd);
      else router.push(`/?do=${cmd}`);
    },
    [pathname, router]
  );

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || needle.split(/\s+/).every((t) => s.toLowerCase().includes(t));
    const actions: Item[] = [
      { id: "a-add", group: "Actions", label: "Add papers", sub: "N", icon: <FilePlus size={18} />, run: () => go("add") },
      { id: "a-col", group: "Actions", label: "New deck", icon: <FolderSimplePlus size={18} />, run: () => go("new-collection") },
      { id: "a-bib", group: "Actions", label: "Export library as BibTeX", icon: <DownloadSimple size={18} />, run: () => go("export-bib") },
      { id: "a-graph", group: "Actions", label: "Open the research graph", icon: <Graph size={18} />, run: () => (setOpen(false), router.push("/graph")) },
      { id: "a-imp", group: "Actions", label: "Import from the old Paper Cards", icon: <ArrowSquareIn size={18} />, run: () => (setOpen(false), router.push("/import")) },
      { id: "a-theme", group: "Actions", label: "Switch theme", icon: <MoonStars size={18} />, run: () => applyTheme(nextTheme(readTheme())) },
    ].filter((a) => match(a.label));
    const paperItems: Item[] = papers
      .filter((p) => match(`${p.title} ${p.authors.map((a) => a.family).join(" ")} ${p.year ?? ""} ${p.journal ?? ""}`))
      .slice(0, needle ? 8 : 5)
      .map((p) => ({
        id: p.id,
        group: needle ? "Papers" : "Recent papers",
        label: p.title,
        sub: [formatAuthorShort(p.authors), p.year].filter(Boolean).join(", "),
        icon: <BookOpenText size={18} />,
        serif: true,
        run: () => (setOpen(false), router.push(`/paper/${p.id}`)),
      }));
    const colItems: Item[] = collections
      .filter((c) => match(c.name))
      .slice(0, 5)
      .map((c) => ({ id: c.id, group: "Decks", label: c.name, icon: <FolderSimple size={18} />, run: () => (setOpen(false), router.push(`/?scope=col:${c.id}`)) }));
    return needle ? [...paperItems, ...colItems, ...actions] : [...actions, ...paperItems, ...colItems];
  }, [q, papers, collections, go, router]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open || !enabled) return null;
  const safeActive = Math.min(active, Math.max(items.length - 1, 0));
  let lastGroup = "";

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="palette-input">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[safeActive] ? `pi-${items[safeActive].id}` : undefined}
            placeholder="Search papers, decks or actions…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[safeActive]?.run();
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {items.length === 0 && <div className="palette-group">No matches for “{q}”</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.id}>
                {head && <div className="palette-group">{head}</div>}
                <button
                  id={`pi-${it.id}`}
                  role="option"
                  aria-selected={i === safeActive}
                  className={`palette-item${it.serif ? " serif" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={it.run}
                >
                  {it.icon}
                  <span className="t">{it.label}</span>
                  {it.sub && <span className="sub">{it.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
