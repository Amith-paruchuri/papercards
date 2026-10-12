"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfJs, openPdf } from "@/lib/pdf/pdfjs";
import type { Highlight, HighlightRect, NoteSection } from "@/lib/types";
import { ArrowCounterClockwise, ArrowsOutLineHorizontal, Copy, MagnifyingGlassMinus, MagnifyingGlassPlus, Plus, Trash, Columns, File as FileIcon } from "@phosphor-icons/react";

export interface PdfViewerHandle {
  jumpTo: (h: Highlight) => void;
}

type Props = {
  data: ArrayBuffer;
  highlights: Highlight[];
  sections: NoteSection[];
  onHighlight: (h: { page: number; text: string; rects: HighlightRect[]; sectionId: string | null; color: string }) => void;
  onNewSectionHighlight: (h: { page: number; text: string; rects: HighlightRect[] }) => void;
  onDeleteHighlight: (h: Highlight) => void;
  onUndo: () => void;
  canUndo: boolean;
  toolbarExtra?: React.ReactNode;
};

type PageSize = { w: number; h: number };
type MenuState =
  | { kind: "select"; page: number; text: string; rects: HighlightRect[]; x: number; y: number }
  | { kind: "existing"; h: Highlight; x: number; y: number }
  | null;

const DEFAULT_HL = "#f0c463";

function hexToRgba(hex: string | null, a: number) {
  const h = (hex || DEFAULT_HL).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Clean up selection text from the PDF text layer: join hard-wrapped lines, fix hyphenation and s p a c e d letters. */
export function reflowSelection(raw: string): string {
  return raw
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n")
        .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
        .replace(/\n/g, " ")
        .replace(/\b(?:\p{L} ){2,}\p{L}\b/gu, (m) => m.replace(/ /g, ""))
        .replace(/\s+/g, " ")
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** Merge per-glyph client rects into per-line rects (fractions of the page). */
function toPageRects(rects: DOMRect[], pageBox: DOMRect): HighlightRect[] {
  const lines: { top: number; bottom: number; left: number; right: number }[] = [];
  for (const r of rects) {
    if (r.width < 1 || r.height < 1) continue;
    const top = Math.max(r.top, pageBox.top);
    const bottom = Math.min(r.bottom, pageBox.bottom);
    if (bottom <= top) continue;
    const line = lines.find((l) => Math.abs(l.top - top) < r.height * 0.5 && Math.abs(l.bottom - bottom) < r.height * 0.6);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, top);
      line.bottom = Math.max(line.bottom, bottom);
    } else lines.push({ top, bottom, left: r.left, right: r.right });
  }
  return lines.map((l) => ({
    x: (l.left - pageBox.left) / pageBox.width,
    y: (l.top - pageBox.top) / pageBox.height,
    w: (l.right - l.left) / pageBox.width,
    h: (l.bottom - l.top) / pageBox.height,
  }));
}

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(props, ref) {
  const { data, highlights, sections, onHighlight, onNewSectionHighlight, onDeleteHighlight, onUndo, canUndo, toolbarExtra } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [scale, setScale] = useState(1.25);
  const [spread, setSpread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(1);
  const [menu, setMenu] = useState<MenuState>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const rendered = useRef<Map<number, number>>(new Map()); // page -> scale it was rendered at
  const renderTokens = useRef<Map<number, { cancel: () => void }>>(new Map());

  // Open the document and measure every page once.
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;
    const tokens = renderTokens.current;
    setError(null);
    setSizes([]);
    rendered.current.clear();
    (async () => {
      try {
        const opened = await openPdf(data);
        destroy = opened.destroy;
        if (cancelled) return void opened.destroy();
        docRef.current = opened.doc;
        const out: PageSize[] = [];
        for (let i = 1; i <= opened.doc.numPages; i++) {
          const vp = (await opened.doc.getPage(i)).getViewport({ scale: 1 });
          out.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return;
        setSizes(out);
        // Fit width by default on narrow stages.
        const stageW = stageRef.current?.clientWidth ?? 800;
        if (out[0] && stageW < out[0].w * 1.25 + 40) setScale(Math.max(0.5, Math.round(((stageW - 40) / out[0].w) * 20) / 20));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      docRef.current = null;
      tokens.forEach((t) => t.cancel());
      tokens.clear();
      if (destroy) void destroy();
    };
  }, [data]);

  const renderPage = useCallback(
    async (pageNo: number, el: HTMLDivElement) => {
      const doc = docRef.current;
      if (!doc || rendered.current.get(pageNo) === scale) return;
      rendered.current.set(pageNo, scale);
      renderTokens.current.get(pageNo)?.cancel();
      const pdfjs = await loadPdfJs();
      const page = await doc.getPage(pageNo);
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const task = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      renderTokens.current.set(pageNo, { cancel: () => task.cancel() });
      try {
        await task.promise;
      } catch {
        rendered.current.delete(pageNo);
        return;
      }
      if (rendered.current.get(pageNo) !== scale) return; // zoom changed meanwhile
      el.querySelector("canvas")?.remove();
      el.querySelector(".placeholder")?.remove();
      el.prepend(canvas);

      el.querySelector(".textLayer")?.remove();
      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      el.appendChild(textDiv);
      const textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      await textLayer.render().catch(() => {});
      const end = document.createElement("div");
      end.className = "endOfContent";
      textDiv.appendChild(end);
      // Keeps a drag from jumping to whole columns/paragraphs (pdf.js "selecting" trick).
      textDiv.addEventListener("pointerdown", () => {
        textDiv.classList.add("selecting");
        window.addEventListener("pointerup", () => textDiv.classList.remove("selecting"), { once: true });
      });
    },
    [scale]
  );

  // Lazy-render pages that come into view; track the current page.
  useEffect(() => {
    if (!sizes.length || !pagesRef.current || !stageRef.current) return;
    // Page elements are re-created when the zoom changes, so forget what was drawn before.
    rendered.current.clear();
    const pageEls = Array.from(pagesRef.current.querySelectorAll<HTMLDivElement>(".pdf-page"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) void renderPage(Number((e.target as HTMLElement).dataset.page), e.target as HTMLDivElement);
        }
      },
      { root: stageRef.current, rootMargin: "800px 0px" }
    );
    pageEls.forEach((el) => io.observe(el));
    const onScroll = () => {
      const stage = stageRef.current!;
      const mid = stage.getBoundingClientRect().top + stage.clientHeight / 3;
      let best = 1;
      for (const el of pageEls) if (el.getBoundingClientRect().top <= mid) best = Number(el.dataset.page);
      setCurrent(best);
    };
    stageRef.current.addEventListener("scroll", onScroll, { passive: true });
    const stage = stageRef.current;
    return () => {
      io.disconnect();
      stage.removeEventListener("scroll", onScroll);
    };
  }, [sizes, scale, spread, renderPage]);

  useImperativeHandle(ref, () => ({
    jumpTo(h: Highlight) {
      const pageEl = pagesRef.current?.querySelector<HTMLDivElement>(`.pdf-page[data-page="${h.page}"]`);
      const stage = stageRef.current;
      if (!pageEl || !stage) return;
      const r = h.rects[0];
      const top = pageEl.offsetTop + (r ? r.y * pageEl.offsetHeight : 0) - stage.clientHeight / 3;
      stage.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      setFlashId(null);
      requestAnimationFrame(() => setFlashId(h.id));
      setTimeout(() => setFlashId((f) => (f === h.id ? null : f)), 2400);
    },
  }));

  function onMouseUp(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".hl-menu")) return;
    const sel = window.getSelection();
    const text = sel ? reflowSelection(sel.toString()) : "";
    if (!sel || !text || sel.rangeCount === 0) {
      if (menu?.kind === "select") setMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as Element | null;
    const pageEl = startEl?.closest<HTMLDivElement>(".pdf-page");
    if (!pageEl || !stageRef.current) return;
    const pageBox = pageEl.getBoundingClientRect();
    const rects = toPageRects(Array.from(range.getClientRects()), pageBox);
    if (!rects.length) return;
    const last = rects[rects.length - 1];
    const stageBox = stageRef.current.getBoundingClientRect();
    setMenu({
      kind: "select",
      page: Number(pageEl.dataset.page),
      text,
      rects,
      x: Math.min(pageBox.left + (last.x + last.w) * pageBox.width - stageBox.left + stageRef.current.scrollLeft, stageRef.current.scrollWidth - 180),
      y: pageBox.top + (last.y + last.h) * pageBox.height - stageBox.top + stageRef.current.scrollTop + 6,
    });
  }

  function save(sectionId: string | null, color: string) {
    if (menu?.kind !== "select") return;
    onHighlight({ page: menu.page, text: menu.text, rects: menu.rects, sectionId, color });
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  }

  function zoom(next: number) {
    setScale(Math.min(4, Math.max(0.4, Math.round(next * 20) / 20)));
    setMenu(null);
  }

  function fitWidth() {
    const stageW = (stageRef.current?.clientWidth ?? 800) - 40;
    const w = sizes[0]?.w ?? 612;
    zoom(spread ? (stageW - 14) / (2 * w) : stageW / w);
  }

  // Keyboard zoom (Cmd/Ctrl + / -) while the pointer is over the viewer.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setScale((s) => Math.min(4, Math.max(0.4, Math.round(s * (e.deltaY < 0 ? 1.08 : 0.926) * 100) / 100)));
      }
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const byPage = new Map<number, Highlight[]>();
  for (const h of highlights) byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]);
  const sectionColor = new Map(sections.map((s) => [s.id, s.color]));

  return (
    <>
      <div className="pdf-toolbar" role="toolbar" aria-label="PDF view">
        <span className="tb-text" aria-live="polite">
          {current} / {sizes.length || "…"}
        </span>
        <span className="tb-sep" />
        <button className="tb-btn" onClick={() => zoom(scale - 0.15)} aria-label="Zoom out" title="Zoom out">
          <MagnifyingGlassMinus size={17} />
        </button>
        <span className="tb-text">{Math.round(scale * 100)}%</span>
        <button className="tb-btn" onClick={() => zoom(scale + 0.15)} aria-label="Zoom in" title="Zoom in">
          <MagnifyingGlassPlus size={17} />
        </button>
        <button className="tb-btn" onClick={fitWidth} title="Fit to width">
          <ArrowsOutLineHorizontal size={17} /> <span className="desktop-only">Fit</span>
        </button>
        <button className={`tb-btn${spread ? " on" : ""}`} aria-pressed={spread} onClick={() => (setSpread((s) => !s), setMenu(null))} title={spread ? "Show one page at a time" : "Show two pages side by side"}>
          {spread ? <Columns size={17} /> : <FileIcon size={17} />} <span className="desktop-only">{spread ? "Two pages" : "One page"}</span>
        </button>
        <span className="tb-sep" />
        <button className="tb-btn" onClick={onUndo} disabled={!canUndo} title="Undo last highlight (⌘Z)">
          <ArrowCounterClockwise size={17} /> <span className="desktop-only">Undo</span>
        </button>
        <span className="spacer" />
        {toolbarExtra}
      </div>
      <div className="pdf-stage" ref={stageRef} onMouseUp={onMouseUp}>
        {error && (
          <div className="notice" role="alert">
            <strong>This PDF won&apos;t open.</strong> {error}. Try replacing it with a fresh download.
          </div>
        )}
        {!error && !sizes.length && <div className="hint">Opening PDF…</div>}
        <div className={`pdf-pages${spread ? " spread" : ""}`} ref={pagesRef}>
          {sizes.map((s, i) => {
            const pageNo = i + 1;
            return (
              <div
                key={`${pageNo}-${scale}`}
                className="pdf-page"
                data-page={pageNo}
                style={
                  {
                    width: s.w * scale,
                    height: s.h * scale,
                    "--scale-factor": scale,
                    "--total-scale-factor": scale,
                    "--scale-round-x": "1px",
                    "--scale-round-y": "1px",
                  } as React.CSSProperties
                }
              >
                <div className="placeholder">{pageNo}</div>
                {(byPage.get(pageNo) ?? []).flatMap((h) =>
                  h.rects.map((r, k) => (
                    <div
                      key={`${h.id}-${k}`}
                      className={`hl-rect${flashId === h.id ? " flash" : ""}`}
                      style={{
                        left: `${r.x * 100}%`,
                        top: `${r.y * 100}%`,
                        width: `${r.w * 100}%`,
                        height: `${r.h * 100}%`,
                        background: hexToRgba(h.color || (h.section_id ? sectionColor.get(h.section_id) ?? null : null), 0.38),
                      }}
                      title={h.text.slice(0, 140)}
                      onMouseUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        const stageBox = stageRef.current!.getBoundingClientRect();
                        setMenu({ kind: "existing", h, x: e.clientX - stageBox.left + stageRef.current!.scrollLeft, y: e.clientY - stageBox.top + stageRef.current!.scrollTop + 8 });
                      }}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
        {menu?.kind === "select" && (
          <div className="hl-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.preventDefault()}>
            <div className="lbl">Add to your notes</div>
            {sections.map((s) => (
              <button key={s.id} onClick={() => save(s.id, s.color || DEFAULT_HL)}>
                <span className="sw" style={{ background: s.color || DEFAULT_HL }} />
                {s.title}
              </button>
            ))}
            <button
              onClick={() => {
                if (menu.kind !== "select") return;
                onNewSectionHighlight({ page: menu.page, text: menu.text, rects: menu.rects });
                window.getSelection()?.removeAllRanges();
                setMenu(null);
              }}
            >
              <Plus size={12} style={{ margin: "0 0 0 0" }} />
              New section…
            </button>
            <hr />
            <button onClick={() => save(null, DEFAULT_HL)}>
              <span className="sw" style={{ background: DEFAULT_HL, opacity: 0.6 }} />
              Highlight without a note
            </button>
            <button
              onClick={() => {
                if (menu.kind === "select") void navigator.clipboard?.writeText(menu.text);
                setMenu(null);
              }}
            >
              <Copy size={14} /> Copy text
            </button>
          </div>
        )}
        {menu?.kind === "existing" && (
          <div className="hl-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="lbl">Highlight on page {menu.h.page}</div>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(menu.h.text);
                setMenu(null);
              }}
            >
              <Copy size={14} /> Copy text
            </button>
            <button
              onClick={() => {
                onDeleteHighlight(menu.h);
                setMenu(null);
              }}
              style={{ color: "var(--seal)" }}
            >
              <Trash size={14} /> Remove highlight
            </button>
            <button onClick={() => setMenu(null)}>Close</button>
          </div>
        )}
      </div>
    </>
  );
});
