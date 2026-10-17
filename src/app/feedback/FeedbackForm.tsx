"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bug, CircleNotch, Heart, Lightbulb, Notebook, ChatCircleDots, ArrowCounterClockwise } from "@phosphor-icons/react";
import { OrigamiMark } from "@/components/Logo";
import { KINDS, RATING_LABELS, ROLES, SURVEY, questionsFor, type Answers, type Kind, type Product, type Question } from "@/lib/feedback";

const KIND_ICON = { bug: Bug, idea: Lightbulb, love: Heart, other: ChatCircleDots } as const;
const PROMPT: Record<Kind, string> = {
  bug: "What did you do, what did you expect, and what happened instead? Which device and browser?",
  idea: "What would you like it to do? What would it help you with?",
  love: "What's working well for you? We'll make sure to keep it.",
  other: "Tell us anything: questions, confusion, first impressions…",
};

function QuestionBlock({ q, value, onChange }: { q: Question; value: string | string[] | undefined; onChange: (v: string | string[] | undefined) => void }) {
  const picked = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <motion.div className="fb-q" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }}>
      <p className="fb-q-label" id={`q-${q.id}`}>
        {q.label}
        {q.multi && <span className="fb-opt"> pick all that apply</span>}
      </p>
      <div className="fb-q-opts" role={q.multi ? "group" : "radiogroup"} aria-labelledby={`q-${q.id}`}>
        {q.options.map((o) => {
          const on = picked.includes(o);
          return (
            <button
              type="button"
              key={o}
              role={q.multi ? "checkbox" : "radio"}
              aria-checked={on}
              className={`fb-pill${on ? " on" : ""}`}
              onClick={() => {
                if (q.multi) {
                  const next = on ? picked.filter((x) => x !== o) : [...picked, o];
                  onChange(next.length ? next : undefined);
                } else onChange(on ? undefined : o);
              }}
            >
              {o}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function ChotiMark() {
  return (
    <span className="fb-app-icon choti" aria-hidden="true">
      <Notebook size={22} weight="duotone" />
    </span>
  );
}

export function FeedbackForm({ initialProduct }: { initialProduct: Product | null }) {
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [kind, setKind] = useState<Kind>("idea");
  const [answers, setAnswers] = useState<Answers>({});
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return setError("Choose which app this is about.");
    const shownQs = questionsFor(product, answers);
    const given = Object.fromEntries(shownQs.filter((q) => answers[q.id] !== undefined).map((q) => [q.id, answers[q.id]]));
    if (message.trim().length < 3 && !Object.keys(given).length) return setError("Answer a question or write a few words so we know what you think.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product, kind: message.trim() ? kind : "other", rating, message, answers: given, name, email, role, website, page: document.referrer || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "We couldn't send that. Try again in a minute.");
      setSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send that. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setSent(false);
    setMessage("");
    setAnswers({});
    setRating(null);
    setKind("idea");
  }

  const shown = hover ?? rating;
  const visibleQs = questionsFor(product, answers);
  const answeredCount = visibleQs.filter((q) => answers[q.id] !== undefined).length;
  const groups = product === "both" ? (["papercards", "choticopy"] as const) : product ? ([product] as const) : [];
  let step = 1;

  return (
    <AnimatePresence mode="wait">
      {sent ? (
        <motion.div
          key="sent"
          className="fb-sent"
          initial={{ opacity: 0, y: 18, rotate: -1.5 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          exit={{ opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          <motion.div className="fb-seal" initial={{ scale: 2.2, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: -8 }} transition={{ delay: 0.25, type: "spring", stiffness: 420, damping: 18 }}>
            受
            <small>received</small>
          </motion.div>
          <h2>Thank you{name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}.</h2>
          <p>
            Your note on <strong>{product === "both" ? "both apps" : product === "choticopy" ? "Choti Copy" : "PaperCards"}</strong> is with the team. We read every message,
            and {email.trim() ? "we'll write back if we have questions." : "the best ones shape what we build next."}
          </p>
          <button className="btn ghost" onClick={again}>
            <ArrowCounterClockwise size={16} /> Send another
          </button>
        </motion.div>
      ) : (
        <motion.form key="form" className="fb-form" onSubmit={submit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }}>
          <fieldset className="fb-step">
            <legend>
              <span className="fb-num">{step++}</span> Which app is this about?
            </legend>
            <div className="fb-apps" role="radiogroup" aria-label="App">
              {(
                [
                  ["papercards", "PaperCards", "Research papers, highlights and notes", <span key="i" className="fb-app-icon"><OrigamiMark size={30} /></span>],
                  ["choticopy", "Choti Copy", "Flashcards and revision", <ChotiMark key="i" />],
                ] as const
              ).map(([id, title, sub, icon]) => (
                <button type="button" role="radio" aria-checked={product === id} key={id} className={`fb-app${product === id ? " on" : ""}`} onClick={() => (setProduct(id), setError(null))}>
                  {icon}
                  <span>
                    <strong>{title}</strong>
                    <span className="fb-app-sub">{sub}</span>
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className={`fb-both${product === "both" ? " on" : ""}`} onClick={() => (setProduct("both"), setError(null))} aria-pressed={product === "both"}>
              It&apos;s about both
            </button>
          </fieldset>

          {product && (
            <fieldset className="fb-step fb-survey">
              <legend>
                <span className="fb-num">{step++}</span> A few quick questions <span className="fb-opt">tap your answers · {answeredCount} of {visibleQs.length}</span>
              </legend>
              {groups.map((g) => (
                <div key={g} className="fb-survey-group">
                  {product === "both" && <h4 className="fb-survey-title">{SURVEY[g].title}</h4>}
                  <AnimatePresence initial={false}>
                    {SURVEY[g].questions
                      .filter((q) => visibleQs.includes(q))
                      .map((q) => (
                        <QuestionBlock
                          key={q.id}
                          q={q}
                          value={answers[q.id]}
                          onChange={(v) => {
                            setError(null);
                            setAnswers((a) => {
                              const next = { ...a };
                              if (v === undefined) delete next[q.id];
                              else next[q.id] = v;
                              return next;
                            });
                          }}
                        />
                      ))}
                  </AnimatePresence>
                </div>
              ))}
            </fieldset>
          )}

          <fieldset className="fb-step">
            <legend>
              <span className="fb-num">{step++}</span> How&apos;s it going so far? <span className="fb-opt">optional</span>
            </legend>
            <div className="fb-rating" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(null)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n}: ${RATING_LABELS[n]}`}
                  className={`fb-dot${shown && n <= shown ? " lit" : ""}`}
                  onMouseEnter={() => setHover(n)}
                  onFocus={() => setHover(n)}
                  onBlur={() => setHover(null)}
                  onClick={() => setRating(rating === n ? null : n)}
                >
                  {n}
                </button>
              ))}
              <span className="fb-rating-label" aria-live="polite">
                {shown ? RATING_LABELS[shown] : "Tap a number"}
              </span>
            </div>
          </fieldset>

          <fieldset className="fb-step">
            <legend>
              <span className="fb-num">{step++}</span> {answeredCount ? "Anything else to tell us?" : "What would you like to share?"}
              {answeredCount > 0 && <span className="fb-opt">optional</span>}
            </legend>
            <div className="fb-kinds" role="radiogroup" aria-label="Kind of feedback">
              {(Object.keys(KINDS) as Kind[]).map((k) => {
                const Icon = KIND_ICON[k];
                return (
                  <button type="button" role="radio" aria-checked={kind === k} key={k} className={`fb-kind k-${k}${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>
                    <Icon size={17} weight={kind === k ? "fill" : "regular"} /> {KINDS[k]}
                  </button>
                );
              })}
            </div>
            <label className="sr-only" htmlFor="fb-message">
              Your message
            </label>
            <textarea id="fb-message" className="fb-message" rows={6} maxLength={5000} placeholder={PROMPT[kind]} value={message} onChange={(e) => (setMessage(e.target.value), error && setError(null))} />
            <div className="fb-count">{message.length > 4000 ? `${5000 - message.length} characters left` : ""}</div>
          </fieldset>

          <fieldset className="fb-step">
            <legend>
              <span className="fb-num">{step++}</span> About you <span className="fb-opt">optional, only if you&apos;d like a reply</span>
            </legend>
            <div className="fb-grid">
              <div>
                <label className="field-label" htmlFor="fb-name">
                  Name
                </label>
                <input id="fb-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name…" />
              </div>
              <div>
                <label className="field-label" htmlFor="fb-email">
                  Email
                </label>
                <input id="fb-email" type="email" autoComplete="email" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@institute.edu…" />
              </div>
              <div className="fb-wide">
                <label className="field-label" htmlFor="fb-role">
                  You are a…
                </label>
                <select id="fb-role" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
            <input className="fb-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </fieldset>

          {error && (
            <div className="error-text" role="alert">
              {error}
            </div>
          )}
          <div className="fb-submit">
            <button className="btn fb-send" disabled={busy}>
              {busy ? (
                <>
                  <CircleNotch size={16} className="spin" /> Sending…
                </>
              ) : (
                "Send feedback"
              )}
            </button>
            <span className="hint">Goes straight to the people building these apps. No account needed.</span>
          </div>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
