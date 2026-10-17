"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleNotch, Eye, EyeSlash, EnvelopeSimpleOpen, Play } from "@phosphor-icons/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PASSWORD_MIN } from "@/lib/auth-validate";
import { resendCode, sendReset, signIn, signUp, verifyCode, type AuthState } from "./actions";

type Mode = "signin" | "signup" | "reset";

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function PasswordInput({ id, name, auto, placeholder }: { id: string; name: string; auto: string; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} name={name} type={show ? "text" : "password"} required autoComplete={auto} placeholder={placeholder} />
      <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeSlash size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

export function LoginForm({
  next,
  initialError,
  googleEnabled,
  initialMode = "signin",
}: {
  next?: string;
  initialError?: string;
  googleEnabled: boolean;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [terms, setTerms] = useState(false);
  const [google, setGoogle] = useState(false);
  const [guest, setGuest] = useState(false);
  const [localError, setLocalError] = useState<string | null>(initialError ?? null);
  const emailRef = useRef<HTMLInputElement>(null);

  const [state, run, pending] = useActionState<AuthState, FormData>(async (prev, fd) => {
    const intent = fd.get("intent");
    if (intent === "signup") return signUp(prev, fd);
    if (intent === "reset") return sendReset(prev, fd);
    if (intent === "verify") return verifyCode(prev, fd);
    if (intent === "resend") return resendCode(prev, fd);
    return signIn(prev, fd);
  }, {});

  // An existing account found during sign-up: switch to Sign in, keeping the email.
  useEffect(() => {
    if (!state.existing) return;
    setMode("signin"); // eslint-disable-line react-hooks/set-state-in-effect -- reacting to the server's answer
    requestAnimationFrame(() => {
      if (emailRef.current && state.email) emailRef.current.value = state.email;
      document.getElementById("password")?.focus();
    });
  }, [state]);

  // Submit without React's automatic form reset, so an error never wipes what the person typed.
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError(null);
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => run(fd));
  };

  const error = localError ?? state.error;
  const busy = pending || google || guest;

  async function withGoogle() {
    setLocalError(null);
    setGoogle(true);
    const redirectTo = new URL("/auth/callback", window.location.origin);
    if (next) redirectTo.searchParams.set("next", next);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo.toString() } });
    if (error) {
      setLocalError("Google sign-in isn't available right now. Use your email instead.");
      setGoogle(false);
    }
  }

  async function tryAsGuest() {
    setLocalError(null);
    setGuest(true);
    const { error } = await supabaseBrowser().auth.signInAnonymously();
    if (error) {
      setLocalError(/anonymous/i.test(error.message) ? "Trying without an account is switched off right now. Create an account instead." : `${error.message} Try again in a moment.`);
      setGuest(false);
      return;
    }
    try {
      sessionStorage.setItem("papercards_welcome", "1");
    } catch {}
    router.replace("/?welcome=1");
  }

  // ---- step 2 of sign-up: the emailed code ----
  if (state.verifyEmail) {
    return (
      <div className="auth-verify">
        <EnvelopeSimpleOpen size={30} weight="duotone" className="auth-verify-icon" />
        <h3>Check your email</h3>
        <p className="hint">{state.message ?? `We sent a 6-digit code to ${state.verifyEmail}.`}</p>
        <form onSubmit={submit}>
          <input type="hidden" name="email" value={state.verifyEmail} />
          <input type="hidden" name="next" value={next ?? "/"} />
          <label className="field-label" htmlFor="code">
            6-digit code
          </label>
          <input id="code" name="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" autoFocus />
          <button className="btn" name="intent" value="verify" disabled={busy}>
            {pending ? <CircleNotch size={16} className="spin" /> : null} Verify and open my library
          </button>
          {state.error && (
            <div className="error-text" role="alert">
              {state.error}
            </div>
          )}
          <div className="auth-links">
            <button type="submit" className="link-btn" name="intent" value="resend" disabled={busy}>
              Send a new code
            </button>
            <a className="link-btn" href="/login?mode=signup">
              Use a different email
            </a>
          </div>
        </form>
        <p className="hint" style={{ marginTop: 12 }}>
          Not there? Check spam or Promotions. Tapping the link in the email works too.
        </p>
      </div>
    );
  }

  return (
    <div className="auth-card">
      {mode !== "reset" && (
        <>
          <button type="button" className="demo-cta" onClick={() => void tryAsGuest()} disabled={busy}>
            <span className="demo-cta-icon" aria-hidden="true">
              {guest ? <CircleNotch size={22} className="spin" /> : <Play size={20} weight="fill" />}
            </span>
            <span className="demo-cta-text">
              <strong>{guest ? "Opening your demo library…" : "Try the live demo"}</strong>
              <span>No sign-up. Five classic papers ready to highlight.</span>
            </span>
            <ArrowRight size={20} className="demo-cta-arrow" aria-hidden="true" />
          </button>
          <div className="or-rule" role="presentation">
            <span>or sign in to keep your own library</span>
          </div>
        </>
      )}
      {googleEnabled && (
        <>
          <button type="button" className="btn ghost google-btn" onClick={() => void withGoogle()} disabled={busy}>
            {google ? <CircleNotch size={16} className="spin" /> : <GoogleGlyph />} Continue with Google
          </button>
          <div className="or-rule" role="presentation">
            <span>or with email</span>
          </div>
        </>
      )}

      {mode !== "reset" && (
        <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
          <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => (setMode("signin"), setLocalError(null))}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => (setMode("signup"), setLocalError(null))}>
            Create account
          </button>
        </div>
      )}

      <form key={mode} onSubmit={submit}>
        <input type="hidden" name="next" value={next ?? "/"} />
        {mode === "reset" && (
          <>
            <h3 className="auth-sub">Reset your password</h3>
            <p className="hint" style={{ marginTop: -4 }}>
              Enter your account email and we&apos;ll send a link to choose a new password.
            </p>
          </>
        )}
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          spellCheck={false}
          placeholder="Email address"
          defaultValue={state.email ?? ""}
        />

        {mode !== "reset" && (
          <>
            <div className="field-row">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              {mode === "signin" && (
                <button type="button" className="link-btn" onClick={() => setMode("reset")}>
                  Forgot password?
                </button>
              )}
            </div>
            <PasswordInput
              id="password"
              name="password"
              auto={mode === "signin" ? "current-password" : "new-password"}
              placeholder={mode === "signin" ? "Your password" : `At least ${PASSWORD_MIN} characters, with a number`}
            />
          </>
        )}
        {mode === "signup" && (
          <>
            <label className="field-label" htmlFor="confirmPassword">
              Confirm password
            </label>
            <PasswordInput id="confirmPassword" name="confirmPassword" auto="new-password" placeholder="Type it again" />
            <label className="terms-check">
              <input type="checkbox" name="acceptTerms" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>
                I agree to the{" "}
                <a href="/terms" target="_blank">
                  Terms
                </a>{" "}
                and{" "}
                <a href="/privacy" target="_blank">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          </>
        )}

        <button className="btn" name="intent" value={mode} disabled={busy || (mode === "signup" && !terms)}>
          {pending ? <CircleNotch size={16} className="spin" /> : null}
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        {state.message && !state.error && (
          <div className="notice" role="status" style={{ marginTop: 12 }}>
            {state.message}
          </div>
        )}
        {mode === "reset" && (
          <div className="auth-links">
            <button type="button" className="link-btn" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          </div>
        )}
      </form>

    </div>
  );
}
