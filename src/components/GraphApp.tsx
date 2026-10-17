"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { select } from "d3-selection";
import "d3-transition"; // adds .transition() to selections for smooth zooms
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { ArrowLeft, ArrowsIn, CaretDown, CornersOut, MagnifyingGlass, Minus, Plus, X } from "@phosphor-icons/react";
import { Brand } from "./Logo";
import { ThemeSelect } from "./ThemeSelect";
import { errorMessage } from "./Toast";
import { listCollections, listLibrary, listTags } from "@/lib/data";
import { buildGraph, neighbours, type Graph, type GraphLink, type GraphNode, type PaperNode } from "@/lib/graph-model";
import { STATUS_LABELS, type Collection, type LibraryPaper, type Tag } from "@/lib/types";

type SimNode = GraphNode & SimulationNodeDatum & { r: number };
type SimLink = Omit<GraphLink, "source" | "target"> & SimulationLinkDatum<SimNode>;

const STATUS_COLOR: Record<string, string> = { to_read: "var(--st-to_read)", reading: "var(--st-reading)", read: "var(--st-read)", annotated: "var(--st-annotated)" };
const hubRadius = (size: number) => 20 + Math.sqrt(size) * 7;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function GraphApp() {
  const router = useRouter();
  const params = useSearchParams();
  const focusDeck = params.get("deck");
  const [data, setData] = useState<{ papers: LibraryPaper[]; collections: Collection[]; tags: Tag[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagThreads, setTagThreads] = useState(true);
  const [authorThreads, setAuthorThreads] = useState(false);
  const [colorBy, setColorBy] = useState<"deck" | "status">("deck");
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null); // a deck hub clicked to spotlight
  const [tip, setTip] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    Promise.all([listLibrary(), listCollections(), listTags()]).then(
      ([papers, collections, tags]) => alive && setData({ papers, collections, tags }),
      (e) => alive && setError(errorMessage(e))
    );
    return () => {
      alive = false;
    };
  }, []);

  const graph: Graph | null = useMemo(
    () => (data ? buildGraph(data.papers, data.collections, data.tags, { focusDeck, tagThreads, authorThreads }) : null),
    [data, focusDeck, tagThreads, authorThreads]
  );
  const deckName = focusDeck ? data?.collections.find((c) => c.id === focusDeck)?.name : null;

  // ---- search: which nodes match
  const matches = useMemo(() => {
    if (!graph || !q.trim()) return null;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = new Set<string>();
    for (const n of graph.nodes) {
      const hay = (n.kind === "paper" ? `${n.label} ${n.byline}` : n.label).toLowerCase();
      if (terms.every((t) => hay.includes(t))) hit.add(n.id);
    }
    return hit;
  }, [graph, q]);

  const lit = useMemo(() => {
    const id = hover ?? pinned;
    if (!graph || !id) return null;
    const set = neighbours(graph, id);
    // A deck spotlights its whole cluster, including papers' other decks.
    if (id.startsWith("deck:")) for (const n of [...set]) if (n.startsWith("paper:")) neighbours(graph, n).forEach((x) => set.add(x));
    return set;
  }, [graph, hover, pinned]);

  // ---- simulation + zoom, driven imperatively so ticks don't re-render React
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<SVGGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const fitted = useRef(false);

  const paint = useCallback(() => {
    const root = viewRef.current;
    if (!root) return;
    for (const n of nodesRef.current) {
      const el = root.querySelector<SVGGElement>(`[data-node="${CSS.escape(n.id)}"]`);
      if (el) el.setAttribute("transform", `translate(${n.x?.toFixed(1)},${n.y?.toFixed(1)})`);
    }
    for (const l of linksRef.current) {
      const el = root.querySelector<SVGPathElement>(`[data-link="${CSS.escape(l.id)}"]`);
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      if (!el || s.x == null || t.x == null) continue;
      if (l.kind === "member") {
        el.setAttribute("d", `M${s.x},${s.y}L${t.x},${t.y}`);
      } else {
        // gentle arcs for deck bridges and threads, so they read apart from membership spokes
        const mx = (s.x + t.x!) / 2;
        const my = (s.y! + t.y!) / 2;
        const dx = t.x! - s.x;
        const dy = t.y! - s.y!;
        const bend = l.kind === "deck" ? 0.18 : 0.1;
        el.setAttribute("d", `M${s.x},${s.y}Q${mx - dy * bend},${my + dx * bend} ${t.x},${t.y}`);
        if (l.kind === "deck") {
          const lab = root.querySelector<SVGTextElement>(`[data-link-label="${CSS.escape(l.id)}"]`);
          lab?.setAttribute("x", String(mx - dy * bend * 0.5));
          lab?.setAttribute("y", String(my + dx * bend * 0.5));
        }
      }
    }
  }, []);

  const fit = useCallback((animate = true) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    const ns = nodesRef.current;
    if (!svg || !z || !ns.length) return;
    const xs = ns.map((n) => n.x ?? 0);
    const ys = ns.map((n) => n.y ?? 0);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...ys) - 60, Math.max(...ys) + 60];
    const { width, height } = svg.getBoundingClientRect();
    const k = Math.max(0.25, Math.min(1.25, 0.92 / Math.max((x1 - x0) / width, (y1 - y0) / height)));
    const t = zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    const sel = select(svg);
    if (animate && !reducedMotion()) sel.transition().duration(650).call(z.transform, t);
    else sel.call(z.transform, t);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .filter((ev: Event & { button?: number; ctrlKey?: boolean }) => !(ev.target as Element).closest?.(".gnode") && !ev.button)
      .on("zoom", (ev: { transform: ZoomTransform }) => {
        transformRef.current = ev.transform;
        viewRef.current?.setAttribute("transform", ev.transform.toString());
        svg.dataset.zoom = ev.transform.k > 1.5 ? "near" : "far";
      });
    zoomRef.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, [graph]);

  useEffect(() => {
    if (!graph) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const decks = graph.nodes.filter((n) => n.kind === "deck");
    const R = 140 + 90 * Math.sqrt(decks.length);
    const deckPos = new Map(decks.map((d, i) => [d.id, { x: Math.cos((i / decks.length) * Math.PI * 2) * R, y: Math.sin((i / decks.length) * Math.PI * 2) * R }]));
    const nodes: SimNode[] = graph.nodes.map((n) => {
      const old = prev.get(n.id);
      const r = n.kind === "deck" ? hubRadius(n.size) : 13;
      if (old) return { ...n, r, x: old.x, y: old.y, vx: 0, vy: 0 };
      // papers start at their deck's hub and blossom outwards
      const home = n.kind === "deck" ? deckPos.get(n.id) : deckPos.get((n as PaperNode).decks[0]);
      return { ...n, r, x: (home?.x ?? 0) + (Math.random() - 0.5) * 30, y: (home?.y ?? 0) + (Math.random() - 0.5) * 30 };
    });
    const links: SimLink[] = graph.links.map((l) => ({ ...l }));
    nodesRef.current = nodes;
    linksRef.current = links;

    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => (l.kind === "member" ? 46 + (l.target as SimNode).r : l.kind === "deck" ? 300 : 80))
          .strength((l) => (l.kind === "member" ? 0.65 : l.kind === "deck" ? Math.min(0.25, 0.05 * l.weight) : 0.04))
      )
      .force("charge", forceManyBody<SimNode>().strength((n) => (n.kind === "deck" ? -1100 : -140)))
      .force("collide", forceCollide<SimNode>().radius((n) => n.r + (n.kind === "deck" ? 18 : 6)).strength(0.9))
      .force("center", forceCenter(0, 0))
      .force("x", forceX<SimNode>(0).strength(0.03))
      .force("y", forceY<SimNode>(0).strength(0.03))
      .alphaDecay(0.035)
      .on("tick", () => {
        paint();
        if (!fitted.current && sim.alpha() < 0.25) {
          fitted.current = true;
          fit();
        }
      });
    simRef.current = sim;
    if (reducedMotion() || prev.size) {
      sim.stop();
      for (let i = 0; i < 220; i++) sim.tick();
      paint();
      if (!fitted.current) {
        fitted.current = true;
        fit(false);
      }
    }
    return () => {
      sim.stop();
    };
  }, [graph, paint, fit]);

  // ---- dragging nodes (click without moving opens the paper / spotlights the deck)
  const drag = useRef<{ id: string; moved: boolean; x0: number; y0: number } | null>(null);
  function onNodeDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id, moved: false, x0: e.clientX, y0: e.clientY };
  }
  function onNodeMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    setTip(null);
    const n = nodesRef.current.find((x) => x.id === d.id);
    const box = svgRef.current!.getBoundingClientRect();
    if (!n) return;
    const [x, y] = transformRef.current.invert([e.clientX - box.left, e.clientY - box.top]);
    n.fx = x;
    n.fy = y;
    simRef.current?.alphaTarget(0.25).restart();
  }
  function onNodeUp(node: GraphNode) {
    const d = drag.current;
    drag.current = null;
    const n = nodesRef.current.find((x) => x.id === node.id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    simRef.current?.alphaTarget(0);
    if (d && !d.moved) activate(node);
  }
  function activate(node: GraphNode) {
    if (node.kind === "paper") router.push(`/paper/${node.paperId}`);
    else setPinned((p) => (p === node.id ? null : node.id));
  }

  function zoomBy(f: number) {
    const svg = svgRef.current;
    if (svg && zoomRef.current) select(svg).transition().duration(220).call(zoomRef.current.scaleBy, f);
  }
  function centreOn(id: string) {
    const svg = svgRef.current;
    const n = nodesRef.current.find((x) => x.id === id);
    if (!svg || !n || !zoomRef.current) return;
    const { width, height } = svg.getBoundingClientRect();
    const k = Math.max(transformRef.current.k, 1.3);
    const t = zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(n.x ?? 0), -(n.y ?? 0));
    select(svg).transition().duration(reducedMotion() ? 0 : 500).call(zoomRef.current.transform, t);
  }

  function showTip(node: GraphNode, e: React.PointerEvent | React.FocusEvent) {
    const box = svgRef.current!.getBoundingClientRect();
    const target = (e.currentTarget as Element).getBoundingClientRect();
    setTip({ node, x: target.left + target.width / 2 - box.left, y: target.top - box.top });
  }

  // ---- side list: every paper, grouped by deck
  const groups = useMemo(() => {
    if (!graph) return [];
    const papers = graph.nodes.filter((n): n is PaperNode => n.kind === "paper");
    return graph.nodes
      .filter((n) => n.kind === "deck")
      .map((d) => ({ deck: d, papers: papers.filter((p) => p.decks.includes(d.id) && (!matches || matches.has(p.id))) }))
      .filter((g) => g.papers.length || !matches);
  }, [graph, matches]);

  const paperCount = graph?.nodes.filter((n) => n.kind === "paper").length ?? 0;
  const deckCount = graph?.nodes.filter((n) => n.kind === "deck" && n.deckId).length ?? 0;
  const deckById = useMemo(() => new Map(graph?.nodes.filter((n) => n.kind === "deck").map((d) => [d.id, d]) ?? []), [graph]);
  const nodeColor = (n: GraphNode) => (n.kind === "paper" && colorBy === "status" ? STATUS_COLOR[n.status] : n.color);
  const dim = (id: string) => (lit && !lit.has(id)) || (matches && !matches.has(id) && !(lit && lit.has(id)));

  return (
    <div className="graph-page">
      <header className="topbar">
        <Link href={focusDeck ? `/?scope=col:${focusDeck}` : "/"} className="btn quiet small" aria-label="Back to library">
          <ArrowLeft size={16} /> <span className="desktop-only">Library</span>
        </Link>
        <Brand />
        <div className="graph-title">
          <h1>{deckName ? deckName : "Research graph"}</h1>
          {graph && (
            <span className="tnum">
              {paperCount} {paperCount === 1 ? "paper" : "papers"}, {deckCount} {deckCount === 1 ? "deck" : "decks"}
            </span>
          )}
        </div>
        <div className="search-box graph-search">
          <MagnifyingGlass size={16} aria-hidden="true" />
          <input type="search" name="graph-q" autoComplete="off" placeholder="Find a paper or deck…" aria-label="Find in the graph" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="icon-btn sm" aria-label="Clear search" onClick={() => setQ("")}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="topbar-actions">
          {focusDeck && (
            <Link className="btn ghost small" href="/graph">
              All decks
            </Link>
          )}
          <ThemeSelect />
        </div>
      </header>

      <div className="graph-body">
        <section className="graph-stage" aria-label="Graph of papers and decks">
          <div className="graph-controls" role="toolbar" aria-label="Graph options">
            <div className="segmented" role="group" aria-label="Colour papers by">
              <button className={colorBy === "deck" ? "on wide" : "wide"} aria-pressed={colorBy === "deck"} onClick={() => setColorBy("deck")}>
                Deck
              </button>
              <button className={colorBy === "status" ? "on wide" : "wide"} aria-pressed={colorBy === "status"} onClick={() => setColorBy("status")}>
                Status
              </button>
            </div>
            <button className={`chip${tagThreads ? " on" : ""}`} aria-pressed={tagThreads} onClick={() => setTagThreads((v) => !v)}>
              <i className="thread-swatch tag" /> Shared tags
            </button>
            <button className={`chip${authorThreads ? " on" : ""}`} aria-pressed={authorThreads} onClick={() => setAuthorThreads((v) => !v)}>
              <i className="thread-swatch author" /> Shared authors
            </button>
          </div>

          <div className="graph-zoom" role="group" aria-label="Zoom">
            <button className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.35)}>
              <Plus size={16} />
            </button>
            <button className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.35)}>
              <Minus size={16} />
            </button>
            <button className="icon-btn" aria-label="Fit everything" onClick={() => fit()}>
              <CornersOut size={16} />
            </button>
            {pinned && (
              <button className="icon-btn" aria-label="Clear spotlight" title="Clear spotlight" onClick={() => setPinned(null)}>
                <ArrowsIn size={16} />
              </button>
            )}
          </div>

          {error && (
            <div className="notice graph-notice" role="alert">
              <strong>The graph didn&apos;t load.</strong> {error}
            </div>
          )}
          {graph && paperCount === 0 && (
            <div className="graph-empty">
              <h2>Nothing to draw yet</h2>
              <p>Add papers and put them in decks. Each deck becomes a cluster, and papers you file in two decks join them.</p>
              <Link className="btn" href="/?do=add">
                Add papers
              </Link>
            </div>
          )}

          <svg ref={svgRef} className={`graph-svg${lit || matches ? " focusing" : ""}`} data-zoom="far" role="img" aria-label={`${paperCount} papers in ${deckCount} decks`}>
            <defs>
              <filter id="hubGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="10" />
              </filter>
            </defs>
            <g ref={viewRef}>
              <g className="links">
                {graph?.links.map((l) => {
                  const src = deckById.get(l.target) ?? deckById.get(l.source);
                  const off = dim(l.source) || dim(l.target);
                  return (
                    <g key={l.id}>
                      <path
                        data-link={l.id}
                        className={`glink ${l.kind}${off ? " off" : ""}${lit && lit.has(l.source) && lit.has(l.target) ? " on" : ""}`}
                        style={{ "--c": l.kind === "member" ? src?.color : undefined, strokeWidth: l.kind === "deck" ? 1.5 + l.weight * 1.2 : undefined } as React.CSSProperties}
                      >
                        {l.label && <title>{l.label}</title>}
                      </path>
                      {l.kind === "deck" && (
                        <text data-link-label={l.id} className={`glink-label${off ? " off" : ""}`} textAnchor="middle">
                          {l.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
              <g className="nodes">
                {graph?.nodes.map((n) =>
                  n.kind === "deck" ? (
                    <g
                      key={n.id}
                      data-node={n.id}
                      className={`gnode deck${dim(n.id) ? " off" : ""}${pinned === n.id ? " pinned" : ""}`}
                      style={{ "--c": n.color } as React.CSSProperties}
                      tabIndex={0}
                      role="button"
                      aria-label={`${n.label}, ${n.size} ${n.size === 1 ? "paper" : "papers"}. Press Enter to spotlight.`}
                      onPointerDown={(e) => onNodeDown(e, n.id)}
                      onPointerMove={onNodeMove}
                      onPointerUp={() => onNodeUp(n)}
                      onPointerEnter={(e) => (setHover(n.id), showTip(n, e))}
                      onPointerLeave={() => (setHover(null), setTip(null))}
                      onFocus={(e) => (setHover(n.id), showTip(n, e))}
                      onBlur={() => (setHover(null), setTip(null))}
                      onKeyDown={(e) => e.key === "Enter" && activate(n)}
                    >
                      <circle className="hub-glow" r={hubRadius(n.size) + 8} filter="url(#hubGlow)" />
                      <circle className="hub" r={hubRadius(n.size)} />
                      <circle className="hub-ring" r={hubRadius(n.size) + 5} />
                      <text className="hub-count tnum" dy="0.35em" textAnchor="middle">
                        {n.size}
                      </text>
                      <text className="hub-label" y={hubRadius(n.size) + 20} textAnchor="middle">
                        {n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label}
                      </text>
                    </g>
                  ) : (
                    <g
                      key={n.id}
                      data-node={n.id}
                      className={`gnode paper${dim(n.id) ? " off" : ""}${lit?.has(n.id) ? " on" : ""}${matches?.has(n.id) ? " hit" : ""}`}
                      style={{ "--c": nodeColor(n), "--st": STATUS_COLOR[n.status] } as React.CSSProperties}
                      tabIndex={0}
                      role="link"
                      aria-label={`${n.label}. ${n.byline}. ${STATUS_LABELS[n.status]}. Press Enter to open.`}
                      onPointerDown={(e) => onNodeDown(e, n.id)}
                      onPointerMove={onNodeMove}
                      onPointerUp={() => onNodeUp(n)}
                      onPointerEnter={(e) => (setHover(n.id), showTip(n, e))}
                      onPointerLeave={() => (setHover(null), setTip(null))}
                      onFocus={(e) => (setHover(n.id), showTip(n, e))}
                      onBlur={() => (setHover(null), setTip(null))}
                      onKeyDown={(e) => e.key === "Enter" && activate(n)}
                    >
                      {/* a tiny index card with its corner folded in the reading-status colour */}
                      <g className="glyph">
                        <rect className="card" x={-11} y={-8} width={22} height={16} rx={2.5} />
                        <path className="fold" d="M5,-8 L11,-8 L11,-2 Z" />
                        <line className="card-line" x1={-7} x2={4} y1={-2} y2={-2} />
                        <line className="card-line" x1={-7} x2={6} y1={2} y2={2} />
                        {n.mine && <rect className="seal" x={-9} y={3.5} width={4} height={4} rx={0.8} />}
                      </g>
                      <text className="paper-label" y={22} textAnchor="middle">
                        {n.label.length > 42 ? n.label.slice(0, 41) + "…" : n.label}
                      </text>
                    </g>
                  )
                )}
              </g>
            </g>
          </svg>

          {tip && (
            <div className="graph-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
              {tip.node.kind === "paper" ? (
                <>
                  <div className="gt-title">{tip.node.label}</div>
                  <div className="gt-by">{tip.node.byline}</div>
                  <div className="gt-row">
                    <span className="status-swatch" style={{ background: STATUS_COLOR[tip.node.status] }} />
                    {STATUS_LABELS[tip.node.status]}
                    {tip.node.mine && <span className="mine-seal">Yours</span>}
                    {tip.node.sections > 0 && (
                      <span className="gt-notes">
                        notes in {tip.node.noted} of {tip.node.sections} sections
                      </span>
                    )}
                  </div>
                  <div className="gt-decks">
                    {tip.node.decks.map((d) => (
                      <span key={d} className="gt-deck" style={{ "--c": deckById.get(d)?.color } as React.CSSProperties}>
                        {deckById.get(d)?.label}
                      </span>
                    ))}
                  </div>
                  <div className="gt-hint">Click to open</div>
                </>
              ) : (
                <>
                  <div className="gt-title">{tip.node.label}</div>
                  <div className="gt-by">
                    {tip.node.size} {tip.node.size === 1 ? "paper" : "papers"}
                  </div>
                  <div className="gt-hint">{pinned === tip.node.id ? "Click to clear the spotlight" : "Click to spotlight this deck"}</div>
                </>
              )}
            </div>
          )}

          <div className="graph-legend" aria-hidden="true">
            <span>
              <i className="lg-hub" /> Deck
            </span>
            <span>
              <i className="lg-card" /> Paper
            </span>
            <span>
              <i className="lg-bridge" /> Decks sharing papers
            </span>
            {tagThreads && (
              <span>
                <i className="thread-swatch tag" /> Same tag
              </span>
            )}
            {authorThreads && (
              <span>
                <i className="thread-swatch author" /> Same author
              </span>
            )}
          </div>
        </section>

        <aside className="graph-panel" aria-label="All papers by deck">
          <div className="gp-head">
            <h2>{matches ? `${[...matches].filter((m) => m.startsWith("paper:")).length} matching` : "All papers"}</h2>
            <span className="hint">by deck</span>
          </div>
          <div className="gp-list">
            {!graph && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 52, marginBottom: 8 }} />)}
            {groups.map(({ deck, papers }) => {
              const open = !collapsed.has(deck.id);
              return (
                <div key={deck.id} className="gp-group" style={{ "--c": deck.color } as React.CSSProperties}>
                  <div className="gp-deck">
                    <button
                      className="gp-deck-btn"
                      aria-expanded={open}
                      onClick={() =>
                        setCollapsed((s) => {
                          const n = new Set(s);
                          if (n.has(deck.id)) n.delete(deck.id);
                          else n.add(deck.id);
                          return n;
                        })
                      }
                    >
                      <CaretDown size={12} className="chev" />
                      <i className="gp-dot" />
                      <span className="gp-name">{deck.label}</span>
                      <span className="tnum count">{papers.length}</span>
                    </button>
                    <button
                      className="icon-btn sm"
                      title="Show in the graph"
                      aria-label={`Show ${deck.label} in the graph`}
                      onClick={() => {
                        setPinned(deck.id);
                        centreOn(deck.id);
                      }}
                    >
                      <MagnifyingGlass size={13} />
                    </button>
                  </div>
                  {open && (
                    <ul>
                      {papers.map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/paper/${p.paperId}`}
                            className={`gp-paper${hover === p.id ? " on" : ""}`}
                            onPointerEnter={() => setHover(p.id)}
                            onPointerLeave={() => setHover(null)}
                            onFocus={() => setHover(p.id)}
                            onBlur={() => setHover(null)}
                          >
                            <i className="gp-card" style={{ "--st": STATUS_COLOR[p.status] } as React.CSSProperties} />
                            <span className="gp-text">
                              <span className="gp-title">{p.label}</span>
                              <span className="gp-by">{p.byline}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
