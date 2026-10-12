"use client";
import { useState } from "react";
import { EnvelopeSimple, CircleNotch } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    const redirect = new URL("/auth/callback", window.location.origin);
    if (next && next.startsWith("/")) redirect.searchParams.set("next", next);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect.toString(), shouldCreateUser: true },
    });
    if (error) {
      setError(`${error.message} Check the address and try again.`);
      setState("idle");
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <div className="notice" role="status">
        <EnvelopeSimple size={22} style={{ display: "block", marginBottom: 6 }} />
        <strong>Check your inbox.</strong> We sent a sign-in link to {email}. Open it in this browser to continue.
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost small" onClick={() => setState("idle")}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate={false}>
      <label className="field-label" htmlFor="email">
        Work or university email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        spellCheck={false}
        placeholder="you@institute.edu…"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn" disabled={state === "sending"}>
        {state === "sending" ? (
          <>
            <CircleNotch size={16} className="spin" /> Sending link…
          </>
        ) : (
          "Email me a sign-in link"
        )}
      </button>
      {error && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
      <p className="hint" style={{ marginTop: 14 }}>
        New here? The same link creates your account.
      </p>
    </form>
  );
}
