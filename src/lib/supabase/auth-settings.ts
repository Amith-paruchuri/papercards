import "server-only";
import { supabaseEnv } from "./env";

/** Whether Google sign-in is switched on in Supabase. Read from the public auth settings, cached for 5 minutes,
 *  so the button appears by itself once the provider is enabled. Any failure hides the button. */
export async function googleSignInEnabled(): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "on") return true;
  if (process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "off") return false;
  try {
    const { url, anonKey } = supabaseEnv();
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey }, next: { revalidate: 300 }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { external?: { google?: boolean } };
    return Boolean(body.external?.google);
  } catch {
    return false;
  }
}
