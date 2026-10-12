"use client";
import { useState } from "react";
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
      setError(error.message);
      setState("idle");
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <div className="notice">
        Check <strong>{email}</strong> for a sign-in link. Open it in this browser to continue.
        <div style={{ marginTop: 8 }}>
          <button className="btn ghost small" onClick={() => setState("idle")}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="email">
        Email
      </label>
      <input id="email" type="email" required autoComplete="email" placeholder="you@institute.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} disabled={state === "sending"}>
        {state === "sending" ? "Sending link…" : "Email me a sign-in link"}
      </button>
      {error && <div className="error-text">{error}</div>}
      <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
        No password needed. New here? The same link creates your account.
      </p>
    </form>
  );
}
