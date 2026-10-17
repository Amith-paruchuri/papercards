"use server";
// PaperCards sign-in, sign-up, email code and password reset. Runs on the server so the checks can't be skipped.
import { resolve4, resolveMx } from "node:dns/promises";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { checkEmail, checkPassword, friendlyAuthError, normaliseEmail, safeNext, TERMS_VERSION } from "@/lib/auth-validate";

export type AuthState = {
  error?: string;
  message?: string;
  /** The sign-up hit an existing account: the form switches to Sign in with the email filled in. */
  existing?: boolean;
  /** Waiting for the 6-digit code that was emailed to this address. */
  verifyEmail?: string;
  email?: string;
};

/** True when the domain can receive mail (an MX record, or an A record as the fallback). Catches invented domains
 *  before an account is made. A DNS hiccup on our side never blocks a real person. */
const KNOWN_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aiims.edu", "rediffmail.com"]);

async function domainReceivesMail(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  if (KNOWN_MAIL.has(domain)) return true;
  if (!(await lookupWorks(domain))) {
    // Before blaming the address, make sure our own DNS works: if even gmail.com can't be found, don't block anyone.
    return !(await lookupWorks("gmail.com"));
  }
  return true;
}

async function lookupWorks(domain: string): Promise<boolean> {
  const within = <T,>(p: Promise<T>) => Promise.race<T>([p, new Promise<T>((_, no) => setTimeout(() => no(new Error("timeout")), 3500))]);
  const missing = (e: unknown) => ["ENOTFOUND", "ENODATA"].includes((e as NodeJS.ErrnoException).code ?? "");
  try {
    if ((await within(resolveMx(domain))).length) return true;
  } catch (e) {
    if (!missing(e)) return true;
  }
  try {
    return (await within(resolve4(domain))).length > 0;
  } catch (e) {
    return !missing(e);
  }
}

/** The site the person is on (production, a preview, or localhost), so email links come back to the same place. */
async function origin(): Promise<string> {
  const h = await headers();
  const o = h.get("origin");
  if (o) return o;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  return process.env.NEXT_PUBLIC_SITE_URL || "https://papercards-pi.vercel.app";
}

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normaliseEmail(form.get("email"));
  const password = form.get("password");
  if (!email || typeof password !== "string" || !password) return { error: "Enter your email and password.", email };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") {
      await supabase.auth.resend({ type: "signup", email });
      return { message: "Your email isn't confirmed yet. We sent a new 6-digit code.", verifyEmail: email, email };
    }
    return { error: friendlyAuthError(error), email };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normaliseEmail(form.get("email"));
  const password = form.get("password");
  const bad = checkEmail(email) ?? checkPassword(password);
  if (bad) return { error: bad, email };
  if (form.get("confirmPassword") !== password) return { error: "The two passwords don't match.", email };
  if (form.get("acceptTerms") !== "on") return { error: "Please accept the Terms and Privacy Policy to continue.", email };
  if (!(await domainReceivesMail(email))) return { error: "That email domain can't receive mail. Check for a typo.", email };

  const next = safeNext(form.get("next"));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: password as string,
    options: {
      emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`,
      data: { terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION },
    },
  });
  if (error) return { error: friendlyAuthError(error), email };
  // Supabase doesn't reveal existing accounts: the "new" user comes back with no identities.
  if (data.user && !(data.user.identities?.length ?? 0)) {
    return { error: "You already have an account with this email. Sign in, or use Forgot password.", existing: true, email };
  }
  if (!data.session) return { message: `We emailed a 6-digit code to ${email}. Enter it below, or tap the link in the email.`, verifyEmail: email, email };
  redirect(next === "/" ? "/?welcome=1" : next);
}

export async function verifyCode(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normaliseEmail(form.get("email"));
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!email) return { error: "Start again from Create account." };
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from the email.", verifyEmail: email, email };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
  if (error) {
    // The same code also works when it came from a sign-in email.
    const again = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (again.error) return { error: "That code is wrong or has expired. Check it, or send a new one.", verifyEmail: email, email };
  }
  const next = safeNext(form.get("next"));
  redirect(next === "/" ? "/?welcome=1" : next);
}

export async function resendCode(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normaliseEmail(form.get("email"));
  if (!email) return { error: "Start again from Create account." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) return { error: friendlyAuthError(error), verifyEmail: email, email };
  return { message: "New code sent. It can take a minute to arrive; check spam too.", verifyEmail: email, email };
}

export async function sendReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normaliseEmail(form.get("email"));
  const bad = checkEmail(email);
  if (bad) return { error: bad, email };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=/account/reset-password` });
  if (error && (error.status === 429 || /rate/i.test(error.message))) return { error: friendlyAuthError(error), email };
  // Same answer whether or not the address has an account, so the form can't be used to find out who's signed up.
  return { message: `If ${email} has a PaperCards account, a reset link is on its way. Open it on this device.`, email };
}

/** Sets or changes the password of whoever is signed in (after a reset link, or from Account). */
export async function setPassword(_prev: AuthState, form: FormData): Promise<AuthState> {
  const password = form.get("password");
  const bad = checkPassword(password);
  if (bad) return { error: bad };
  if (form.get("confirmPassword") !== password) return { error: "The two passwords don't match." };
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your reset link has expired. Ask for a new one from the sign-in page." };
  const { error } = await supabase.auth.updateUser({ password: password as string });
  if (error) return { error: friendlyAuthError(error) };
  if (form.get("then") === "home") redirect("/?password=updated");
  return { message: "Password saved." };
}
