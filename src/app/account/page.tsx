import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Brand } from "@/components/Logo";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ kept?: string }> }) {
  const { kept } = await searchParams;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/login?next=/account");
  const providers = (user.identities ?? []).map((i) => i.provider);
  const hasPassword = providers.includes("email");
  const since = new Date(user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="simple-page" id="main">
      <div className="simple-card wide">
        <div className="row">
          <Brand href="/" />
          <span className="grow" />
          <Link className="btn ghost small" href="/">
            Back to library
          </Link>
        </div>
        <h1>Account</h1>
        {kept && !user.is_anonymous && (
          <div className="notice" role="status">
            <strong>Your library is kept.</strong> It&apos;s now tied to {user.email}. Set a password below so you can sign in on other devices.
          </div>
        )}
        {user.is_anonymous ? (
          <div className="notice">
            You&apos;re using PaperCards as a guest. Use <strong>Keep this library</strong> on the library page to add your email, then come back here to set a
            password.
          </div>
        ) : (
          <dl className="acct-facts">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Signs in with</dt>
            <dd>{providers.map((p) => (p === "email" ? "Email and password" : p === "google" ? "Google" : p)).join(", ") || "Email link"}</dd>
            <dt>Member since</dt>
            <dd>{since}</dd>
          </dl>
        )}

        {!user.is_anonymous && (
          <section className="acct-section">
            <h2>{hasPassword ? "Change password" : "Set a password"}</h2>
            <p className="hint">{hasPassword ? "Choose a new password for signing in with your email." : "Add a password so you can also sign in with your email."}</p>
            <SetPasswordForm label={hasPassword ? "Change password" : "Set password"} />
          </section>
        )}

        <section className="acct-section">
          <h2>Help us improve</h2>
          <p className="hint">Found a bug, or wish PaperCards did something? Tell us; we read every message.</p>
          <Link className="btn ghost" href="/feedback?product=papercards">
            Share feedback
          </Link>
        </section>

        <form action="/auth/signout" method="post" className="acct-section">
          <button className="btn quiet" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
