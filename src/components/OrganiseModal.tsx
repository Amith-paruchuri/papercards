"use client";
import { useMemo, useState } from "react";
import { ArrowsClockwise, CircleNotch, Sparkle, X } from "@phosphor-icons/react";
import { errorMessage } from "./Toast";
import { addPapersToCollection, createCollection, deleteCollection, removePaperFromCollection } from "@/lib/data";
import { DECK_HUES } from "@/lib/graph-model";
import { byline } from "@/lib/graph-model";
import type { DeckProposal } from "@/lib/ai-decks";
import type { Collection, LibraryPaper, Tag } from "@/lib/types";

type Draft = DeckProposal & { include: boolean; picked: Set<string> };

/** Ask the AI to sort papers into decks, review every suggestion, then apply (with Undo). Nothing changes before Apply. */
export function OrganiseModal({
  papers,
  collections,
  tags,
  onClose,
  onApplied,
}: {
  papers: LibraryPaper[];
  collections: Collection[];
  tags: Tag[];
  onClose: () => void;
  onApplied: (summary: string, undo: () => Promise<void>) => void;
}) {
  const loose = papers.filter((p) => !p.collection_papers.length);
  const [scope, setScope] = useState<"loose" | "all">(loose.length >= 2 ? "loose" : "all");
  const [phase, setPhase] = useState<"setup" | "thinking" | "review" | "applying">("setup");
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const pool = scope === "loose" ? loose : papers;
  const refOf = useMemo(() => new Map(pool.map((p, i) => [`p${i + 1}`, p])), [pool]);
  const deckRef = useMemo(() => new Map(collections.map((c, i) => [`d${i + 1}`, c])), [collections]);
  const deckName = useMemo(() => new Map(collections.map((c) => [c.id, c.name])), [collections]);
  const tagName = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);

  async function suggest() {
    setError(null);
    setPhase("thinking");
    try {
      const body = {
        scope,
        papers: [...refOf].map(([ref, p]) => ({
          ref,
          title: p.title,
          year: p.year,
          journal: p.journal,
          abstract: p.abstract,
          tags: p.paper_tags.map((t) => tagName.get(t.tag_id)).filter(Boolean),
          decks: p.collection_papers.map((c) => deckName.get(c.collection_id)).filter(Boolean),
        })),
        decks: [...deckRef].map(([ref, c]) => ({ ref, name: c.name, size: papers.filter((p) => p.collection_papers.some((m) => m.collection_id === c.id)).length })),
      };
      const res = await fetch("/api/ai/decks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { decks?: DeckProposal[]; error?: string };
      if (!res.ok || !json.decks) throw new Error(json.error || "The AI couldn't organise these papers. Try again.");
      setDrafts(json.decks.map((d) => ({ ...d, include: true, picked: new Set(d.paperRefs) })));
      setPhase("review");
    } catch (e) {
      setError(errorMessage(e));
      setPhase("setup");
    }
  }

  const chosen = drafts.filter((d) => d.include && d.picked.size);
  const filed = new Set(chosen.flatMap((d) => [...d.picked])).size;
  const newDecks = chosen.filter((d) => !d.existingRef).length;

  async function apply() {
    setPhase("applying");
    const created: string[] = [];
    const added: [string, string][] = [];
    try {
      for (const d of chosen) {
        const colId = d.existingRef ? deckRef.get(d.existingRef)!.id : (await createCollection(d.name.trim() || "New deck")).id;
        if (!d.existingRef) created.push(colId);
        const ids = [...d.picked].map((r) => refOf.get(r)!.id);
        await addPapersToCollection(ids, colId);
        ids.forEach((id) => added.push([id, colId]));
      }
      const undo = async () => {
        for (const [paperId, colId] of added) if (!created.includes(colId)) await removePaperFromCollection(paperId, colId);
        for (const id of created) await deleteCollection(id);
      };
      onApplied(`Filed ${filed} ${filed === 1 ? "paper" : "papers"}${newDecks ? ` into ${newDecks} new ${newDecks === 1 ? "deck" : "decks"}` : ""}.`, undo);
    } catch (e) {
      setError(errorMessage(e));
      setPhase("review");
    }
  }

  const update = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && phase !== "applying" && onClose()}>
      <div className="modal organise-modal" role="dialog" aria-modal="true" aria-labelledby="org-title">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h3 id="org-title" className="grow">
            <Sparkle size={20} weight="fill" className="org-spark" /> {phase === "review" || phase === "applying" ? "Suggested decks" : "Organise into decks"}
          </h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose} disabled={phase === "applying"}>
            <X size={18} />
          </button>
        </div>

        {(phase === "setup" || phase === "thinking") && (
          <>
            <p className="hint" style={{ marginTop: -4 }}>
              The AI reads each paper&apos;s title, journal, abstract and tags and suggests decks by research theme. It reuses your existing decks where they fit.
              Nothing changes until you review the suggestions and press Apply, and you can undo afterwards.
            </p>
            <div className="org-scope" role="radiogroup" aria-label="Which papers">
              <label className={scope === "loose" ? "on" : ""}>
                <input type="radio" name="scope" checked={scope === "loose"} disabled={loose.length < 2 || phase === "thinking"} onChange={() => setScope("loose")} />
                <span>
                  <strong>Papers not in any deck</strong>
                  <span className="hint">
                    {loose.length} {loose.length === 1 ? "paper" : "papers"}. Your decks stay as they are; these get filed.
                  </span>
                </span>
              </label>
              <label className={scope === "all" ? "on" : ""}>
                <input type="radio" name="scope" checked={scope === "all"} disabled={phase === "thinking"} onChange={() => setScope("all")} />
                <span>
                  <strong>My whole library</strong>
                  <span className="hint">
                    {papers.length} papers. Papers can also join a second deck where they clearly belong; nothing is removed from a deck.
                  </span>
                </span>
              </label>
            </div>
            {phase === "thinking" && (
              <div className="org-thinking" role="status">
                <div className="org-shuffle" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                Reading {pool.length} titles and abstracts and sorting them into themes…
              </div>
            )}
            {error && (
              <div className="error-text" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn quiet" onClick={onClose}>
                Cancel
              </button>
              <button className="btn" onClick={() => void suggest()} disabled={phase === "thinking" || pool.length < 2}>
                {phase === "thinking" ? (
                  <>
                    <CircleNotch size={15} className="spin" /> Organising…
                  </>
                ) : (
                  <>
                    <Sparkle size={15} weight="fill" /> Suggest decks
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {(phase === "review" || phase === "applying") && (
          <>
            <p className="hint" style={{ marginTop: -4 }}>
              Rename a deck, untick papers that don&apos;t belong, or leave a whole deck out. Existing decks only gain papers.
            </p>
            <div className="org-grid">
              {drafts.map((d, i) => {
                const color = d.existingRef
                  ? DECK_HUES[[...deckRef.keys()].indexOf(d.existingRef) % DECK_HUES.length]
                  : DECK_HUES[(collections.length + drafts.slice(0, i).filter((x) => !x.existingRef).length) % DECK_HUES.length];
                return (
                  <section key={i} className={`org-deck${d.include ? "" : " off"}`} style={{ "--c": color } as React.CSSProperties}>
                    <header>
                      <input type="checkbox" checked={d.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Include ${d.name}`} />
                      {d.existingRef ? (
                        <span className="org-name fixed">{d.name}</span>
                      ) : (
                        <input type="text" className="org-name" value={d.name} aria-label="Deck name" onChange={(e) => update(i, { name: e.target.value })} />
                      )}
                      <span className={`org-badge${d.existingRef ? " existing" : ""}`}>{d.existingRef ? "Existing deck" : "New deck"}</span>
                    </header>
                    {d.why && <p className="org-why">{d.why}</p>}
                    <ul>
                      {d.paperRefs.map((r) => {
                        const p = refOf.get(r)!;
                        return (
                          <li key={r}>
                            <label>
                              <input
                                type="checkbox"
                                checked={d.picked.has(r)}
                                disabled={!d.include}
                                onChange={() => {
                                  const picked = new Set(d.picked);
                                  if (picked.has(r)) picked.delete(r);
                                  else picked.add(r);
                                  update(i, { picked });
                                }}
                              />
                              <span>
                                <span className="org-paper">{p.title}</span>
                                <span className="org-by">{byline(p)}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
            {error && (
              <div className="error-text" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn quiet" onClick={() => void suggest()} disabled={phase === "applying"}>
                <ArrowsClockwise size={15} /> Suggest again
              </button>
              <span className="spacer" />
              <button className="btn" onClick={() => void apply()} disabled={!filed || phase === "applying"}>
                {phase === "applying" ? (
                  <>
                    <CircleNotch size={15} className="spin" /> Filing…
                  </>
                ) : (
                  `Apply: file ${filed} ${filed === 1 ? "paper" : "papers"}${newDecks ? `, ${newDecks} new ${newDecks === 1 ? "deck" : "decks"}` : ""}`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
