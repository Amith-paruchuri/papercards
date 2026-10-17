// Sign-in and sign-up checks shared by the server actions and the forms. Pure functions, no network.

export const PASSWORD_MIN = 8;
export const TERMS_VERSION = "2026-10-17";

/** Throwaway inbox services: accounts made with these can't be recovered, so we ask for a real address. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com", "10minutemail.com", "10minutemail.net",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "yopmail.com", "yopmail.net", "trashmail.com",
  "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mintemail.com", "throwawaymail.com", "fakeinbox.com",
  "mohmal.com", "emailondeck.com", "mailnesia.com", "spamgourmet.com", "tempinbox.com", "burnermail.io", "moakt.com",
  "example.com", "example.org", "test.com",
]);

/** Common typos of big providers, offered back as "Did you mean …?" */
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gnail.com": "gmail.com", "hotmial.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "outlok.com": "outlook.com", "outlook.co": "outlook.com", "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "icloud.co": "icloud.com", "iclod.com": "icloud.com",
};

export function normaliseEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** Returns an error sentence, or null when the address looks usable. */
export function checkEmail(email: string): string | null {
  if (!email) return "Enter your email address.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return "That email address doesn't look right. Check it and try again.";
  const domain = email.split("@")[1];
  if (TYPOS[domain]) return `Did you mean ${email.split("@")[0]}@${TYPOS[domain]}?`;
  if (DISPOSABLE.has(domain)) return "Please use an email you'll keep, such as your university or work address.";
  return null;
}

export function checkPassword(password: unknown): string | null {
  if (typeof password !== "string" || !password) return "Enter a password.";
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for your password.`;
  if (password.length > 72) return "Use 72 characters or fewer for your password.";
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "Mix letters and at least one number in your password.";
  return null;
}

/** Only same-site paths; never an open redirect. */
export function safeNext(value: unknown, fallback = "/"): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

/** Turns Supabase auth errors into sentences a researcher can act on. */
export function friendlyAuthError(e: { message?: string; code?: string; status?: number } | null | undefined): string {
  const code = e?.code ?? "";
  const msg = (e?.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || msg.includes("invalid login")) return "Wrong email or password.";
  if (code === "over_email_send_rate_limit" || msg.includes("rate limit") || e?.status === 429)
    return "Too many emails sent just now. Wait a minute and try again.";
  if (code === "weak_password") return "Choose a stronger password: longer, with letters and numbers.";
  if (code === "same_password") return "That's your current password. Choose a new one.";
  if (code === "otp_expired" || msg.includes("expired")) return "That code or link has expired. Ask for a new one.";
  if (code === "email_address_invalid") return "That email address can't receive mail. Check it and try again.";
  if (code === "signup_disabled") return "New sign-ups are paused right now. Try again later.";
  if (code === "email_exists" || code === "user_already_exists") return "An account with this email already exists. Sign in instead.";
  if (msg.includes("error sending") || msg.includes("smtp")) return "We couldn't send the email just now. Try again in a few minutes.";
  return e?.message ? `${e.message.replace(/\.$/, "")}.` : "Something went wrong. Try again.";
}
