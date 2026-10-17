"use client";
import { useState } from "react";
import { CheckCircle, CircleNotch, Key, Sparkle, X } from "@phosphor-icons/react";
import { errorMessage } from "./Toast";
import { readOwnKey, testOwnKey, writeOwnKey } from "@/lib/ai-client";

/** AI settings: PaperCards' AI by default, or the researcher's own Google AI Studio key (kept only in this browser). */
export function AiSettingsModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [saved, setSaved] = useState(() => readOwnKey());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const masked = saved ? `${saved.slice(0, 4)}…${saved.slice(-4)}` : "";

  async function save() {
    const key = draft.trim();
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(key)) return setError("That doesn't look like a Google AI Studio key. It usually starts with AIza.");
    setBusy(true);
    setError(null);
    try {
      await testOwnKey(key);
      writeOwnKey(key);
      setSaved(key);
      setDraft("");
      onDone("Your own API key works and is now used for AI in this browser.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal ai-settings" role="dialog" aria-modal="true" aria-labelledby="ai-set-title" style={{ width: "min(520px, 100%)" }}>
        <div className="row">
          <h3 id="ai-set-title" className="grow">
            <Sparkle size={20} weight="fill" className="org-spark" /> AI settings
          </h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className={`ai-mode${saved ? "" : " on"}`}>
          <CheckCircle size={18} weight={saved ? "regular" : "fill"} />
          <div>
            <strong>PaperCards AI</strong>
            <span className="hint">Works with no setup. Rewriting highlights, Ask AI and organising decks run on our Gemini account.</span>
          </div>
        </div>
        <div className={`ai-mode${saved ? " on" : ""}`}>
          <CheckCircle size={18} weight={saved ? "fill" : "regular"} />
          <div>
            <strong>My own Google AI Studio key</strong>
            <span className="hint">
              For heavy use. Calls run on your key and your quota. The key stays in this browser only: it is sent with each AI request, used for that call and never
              stored on our server.
            </span>
            {saved && (
              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                <span className="mono ai-key-mask">
                  <Key size={14} /> {masked}
                </span>
                <button
                  className="btn ghost small"
                  onClick={() => {
                    writeOwnKey("");
                    setSaved("");
                    onDone("Removed your key. AI now runs on PaperCards again.");
                  }}
                >
                  Remove key
                </button>
              </div>
            )}
          </div>
        </div>

        <label className="field-label" htmlFor="own-key">
          {saved ? "Replace with another key" : "Paste your key"}
        </label>
        <input
            id="own-key"
            style={{ width: "100%" }}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && draft && void save()}
          />
        <p className="hint" style={{ marginTop: 6 }}>
          Get a free key at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com/apikey
          </a>
          . On Google&apos;s free tier your prompts may be used to improve Google&apos;s products; a paid key keeps unpublished work out of that.
        </p>
        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn quiet" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="btn" onClick={() => void save()} disabled={!draft.trim() || busy}>
            {busy ? (
              <>
                <CircleNotch size={15} className="spin" /> Checking key…
              </>
            ) : (
              "Check and save key"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
