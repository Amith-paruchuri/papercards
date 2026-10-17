import type { Metadata } from "next";
import { isConfigured } from "@/lib/supabase/env";
import { LoginForm } from "./LoginForm";
import { Brand } from "@/components/Logo";
import { AuthStage } from "@/components/AuthStage";
import { googleSignInEnabled } from "@/lib/supabase/auth-settings";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; mode?: string }> }) {
  const { next, error, mode } = await searchParams;
  const configured = isConfigured();
  const google = configured ? await googleSignInEnabled() : false;
  const forbidden = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").includes("nyxivqlpikoffdopfmei");
  return (
    <main className="auth" id="main">
      <section className="auth-story">
        <Brand href="/login" />
        <h1 className="rise">
          <span style={{ "--i": 0 } as React.CSSProperties}>Every paper you read,</span>{" "}
          <span style={{ "--i": 1 } as React.CSSProperties}>and what you made of it.</span>
        </h1>
        <p className="rise-p">Highlight a PDF and the passage lands in your notes, under the right section. Export the citations when it&apos;s time to write.</p>
        <AuthStage />
        <ul className="auth-proof rise-p" aria-label="What you get">
          <li>Notes per section, from your highlights</li>
          <li>BibTeX, RIS and Excel export</li>
          <li>Private to your account</li>
          <li>
            <a href="/feedback">Share feedback</a>
          </li>
        </ul>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <h2>{mode === "signup" ? "Create your library" : "Welcome to PaperCards"}</h2>
          <p>Sign in or create a free account. Your papers and notes stay private to you.</p>
          {forbidden ? (
            <div className="notice" role="alert">
              <strong>Stopped.</strong> <code>.env.local</code> points at another product&apos;s Supabase project. PaperCards needs its own.
            </div>
          ) : !configured ? (
            <div className="notice">
              <strong>Almost ready.</strong> Copy <code>.env.local.example</code> to <code>.env.local</code>, add the PaperCards Supabase URL and anon key, then restart{" "}
              <code>npm run dev</code>.
            </div>
          ) : (
            <LoginForm next={next} initialError={error} googleEnabled={google} initialMode={mode === "signup" ? "signup" : mode === "reset" ? "reset" : "signin"} />
          )}
        </div>
      </section>
    </main>
  );
}
