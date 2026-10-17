"use client";
import { useMemo, useState } from "react";
import { Bug, ChatCircleDots, Copy, DownloadSimple, EnvelopeSimple, Heart, Lightbulb, MagnifyingGlass, Trash } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { downloadText } from "@/lib/download";
import { feedbackCsv, KINDS, PRODUCTS, questionById, RATING_LABELS, STATUSES, SURVEY, type FeedbackRow, type Kind, type Product, type Status } from "@/lib/feedback";

/** Short labels for the answers shown on each response. */
const SHORT: Record<string, string> = {
  cc_anki: "Uses Anki",
  cc_vs_anki: "Versus Anki",
  cc_freetime: "Free-time revision",
  cc_adopt: "Will use Choti Copy",
  cc_recommend: "Recommend",
  pc_tool: "Uses now",
  pc_vs_tool: "Versus current tool",
  pc_adopt: "Will use PaperCards",
  pc_sections: "Section notes useful",
  pc_recommend: "Recommend",
};

function SurveySummary({ rows, product }: { rows: FeedbackRow[]; product: Product | "all" }) {
  const sets = product === "all" ? (["papercards", "choticopy"] as const) : product === "both" ? (["papercards", "choticopy"] as const) : ([product] as const);
  const cards = sets.flatMap((set) =>
    SURVEY[set].questions.map((q) => {
      const answered = rows.filter((r) => r.answers?.[q.id] !== undefined);
      const counts = q.options.map((o) => ({ o, n: answered.filter((r) => [r.answers[q.id]].flat().includes(o)).length }));
      return { q, set, total: answered.length, counts };
    })
  ).filter((c) => c.total > 0);
  if (!cards.length) return null;
  return (
    <details className="survey-toggle" open>
      <summary className="field-label" style={{ cursor: "pointer" }}>
        Question results ({cards.length} answered questions)
      </summary>
      <div className="survey-summary">
        {cards.map(({ q, set, total, counts }) => (
          <div className="ss-card" key={q.id}>
            <h3>{q.label}</h3>
            <span className="hint">
              {PRODUCTS[set]} · {total} {total === 1 ? "answer" : "answers"}
              {q.multi ? " · could pick several" : ""}
            </span>
            {counts.map(({ o, n }) => (
              <div className="ss-row" key={o}>
                <span>{o}</span>
                <b>
                  {n} · {Math.round((n / total) * 100)}%
                </b>
                <span className="ss-bar">
                  <i style={{ width: `${(n / total) * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
import { useToast } from "@/components/Toast";

const KIND_ICON = { bug: Bug, idea: Lightbulb, love: Heart, other: ChatCircleDots } as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function FeedbackInbox({ initial }: { initial: FeedbackRow[] }) {
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [product, setProduct] = useState<Product | "all">("all");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [status, setStatus] = useState<Status | "open" | "all">("open");
  const [q, setQ] = useState("");

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (product === "all" || r.product === product || r.product === "both") &&
          (kind === "all" || r.kind === kind) &&
          (status === "all" || (status === "open" ? !["done", "wont_do"].includes(r.status) : r.status === status)) &&
          (!q || `${r.message} ${Object.values(r.answers ?? {}).flat().join(" ")} ${r.name ?? ""} ${r.email ?? ""} ${r.admin_note ?? ""}`.toLowerCase().includes(q.toLowerCase()))
      ),
    [rows, product, kind, status, q]
  );

  const stats = useMemo(() => {
    const rated = rows.filter((r) => r.rating);
    return {
      total: rows.length,
      fresh: rows.filter((r) => r.status === "new").length,
      bugs: rows.filter((r) => r.kind === "bug" && !["done", "wont_do"].includes(r.status)).length,
      avg: rated.length ? (rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length).toFixed(1) : "–",
      pc: rows.filter((r) => r.product !== "choticopy").length,
      cc: rows.filter((r) => r.product !== "papercards").length,
    };
  }, [rows]);

  async function update(id: string, patch: Partial<Pick<FeedbackRow, "status" | "admin_note">>) {
    const before = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabaseBrowser().from("feedback").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      setRows(before);
      toast(`Couldn't save: ${error.message}`, { err: true });
    }
  }

  async function remove(r: FeedbackRow) {
    if (!confirm("Delete this feedback for good?")) return;
    const { error } = await supabaseBrowser().from("feedback").delete().eq("id", r.id);
    if (error) return toast(`Couldn't delete: ${error.message}`, { err: true });
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    toast("Deleted.");
  }

  return (
    <div className="inbox">
      <div className="inbox-head">
        <div>
          <h1>Feedback inbox</h1>
          <p className="hint">Everything people send from the feedback form, newest first. Only you (and other admins) can see this.</p>
        </div>
        <button className="btn ghost small" onClick={() => downloadText(`feedback-${new Date().toISOString().slice(0, 10)}.csv`, feedbackCsv(shown), "text/csv;charset=utf-8")} disabled={!shown.length}>
          <DownloadSimple size={15} /> Export {shown.length} to Excel
        </button>
      </div>

      <div className="inbox-stats">
        <div><strong>{stats.total}</strong><span>responses</span></div>
        <div className={stats.fresh ? "hot" : ""}><strong>{stats.fresh}</strong><span>unread</span></div>
        <div><strong>{stats.bugs}</strong><span>open bugs</span></div>
        <div><strong>{stats.avg}</strong><span>average rating</span></div>
        <div><strong>{stats.pc}</strong><span>PaperCards</span></div>
        <div><strong>{stats.cc}</strong><span>Choti Copy</span></div>
      </div>

      <div className="inbox-filters">
        <div className="seg" role="group" aria-label="App">
          {(["all", "papercards", "choticopy"] as const).map((p) => (
            <button key={p} className={product === p ? "on" : ""} onClick={() => setProduct(p)}>
              {p === "all" ? "Both apps" : PRODUCTS[p]}
            </button>
          ))}
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind | "all")} aria-label="Type">
          <option value="all">All types</option>
          {(Object.keys(KINDS) as Kind[]).map((k) => (
            <option key={k} value={k}>{KINDS[k]}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | "open" | "all")} aria-label="Status">
          <option value="open">Open (not done)</option>
          <option value="all">Every status</option>
          {(Object.keys(STATUSES) as Status[]).map((s) => (
            <option key={s} value={s}>{STATUSES[s]}</option>
          ))}
        </select>
        <label className="inbox-search">
          <MagnifyingGlass size={15} />
          <input type="search" placeholder="Search messages…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search feedback" />
        </label>
      </div>

      <SurveySummary rows={shown} product={product} />

      {!shown.length ? (
        <div className="inbox-empty">
          {rows.length ? "Nothing matches these filters." : "No feedback yet. Share the form link: people's messages will appear here."}
        </div>
      ) : (
        <ul className="inbox-list">
          {shown.map((r) => {
            const Icon = KIND_ICON[r.kind];
            return (
              <li key={r.id} className={`inbox-item k-${r.kind}${r.status === "new" ? " unread" : ""}`}>
                <div className="ii-meta">
                  <span className={`ii-app a-${r.product}`}>{PRODUCTS[r.product]}</span>
                  <span className="ii-kind">
                    <Icon size={14} weight="fill" /> {KINDS[r.kind]}
                  </span>
                  {r.rating && (
                    <span className="ii-rating" title={RATING_LABELS[r.rating]}>
                      {"●".repeat(r.rating)}
                      <span className="ii-rating-off">{"●".repeat(5 - r.rating)}</span>
                    </span>
                  )}
                  <span className="grow" />
                  <time className="hint">{when(r.created_at)}</time>
                </div>
                {r.message && <p className="ii-msg">{r.message}</p>}
                {Object.keys(r.answers ?? {}).length > 0 && (
                  <dl className="ii-answers">
                    {Object.entries(r.answers).map(([id, a]) => (
                      <div key={id}>
                        <dt>{SHORT[id] ?? questionById(id)?.label ?? id}</dt>
                        <dd>{Array.isArray(a) ? a.join(", ") : a}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="ii-who hint">
                  {[r.name, r.role].filter(Boolean).join(" · ") || "Anonymous"}
                  {r.email && (
                    <>
                      {" · "}
                      <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Your ${PRODUCTS[r.product]} feedback`)}`}>
                        <EnvelopeSimple size={13} /> {r.email}
                      </a>
                    </>
                  )}
                  {r.user_agent && <span className="ii-ua" title={r.user_agent}> · {/Mobile|iPhone|Android/.test(r.user_agent) ? "phone" : "computer"}</span>}
                </div>
                <div className="ii-actions">
                  <select value={r.status} onChange={(e) => void update(r.id, { status: e.target.value as Status })} aria-label="Status" className={`ii-status s-${r.status}`}>
                    {(Object.keys(STATUSES) as Status[]).map((s) => (
                      <option key={s} value={s}>{STATUSES[s]}</option>
                    ))}
                  </select>
                  <input
                    className="ii-note"
                    type="text"
                    placeholder="Your note (only you see this)…"
                    defaultValue={r.admin_note ?? ""}
                    onBlur={(e) => e.target.value !== (r.admin_note ?? "") && void update(r.id, { admin_note: e.target.value || null })}
                    aria-label="Private note"
                  />
                  <button className="icon-btn" title="Copy message" aria-label="Copy message" onClick={() => void navigator.clipboard?.writeText(r.message).then(() => toast("Copied."))}>
                    <Copy size={16} />
                  </button>
                  <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => void remove(r)}>
                    <Trash size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
