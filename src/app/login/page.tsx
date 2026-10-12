import type { Metadata } from "next";
import { isConfigured } from "@/lib/supabase/env";
import { LoginForm } from "./LoginForm";
import { Brand } from "@/components/Logo";
import { PaperCard } from "@/components/PaperCard";
import { SAMPLE_CARDS } from "@/lib/sample-cards";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const configured = isConfigured();
  const forbidden = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").includes("nyxivqlpikoffdopfmei");
  return (
    <main className="auth" id="main">
      <section className="auth-story">
        <Brand href="/login" />
        <h1>Every paper you read, and what you made of it.</h1>
        <p>Highlight a PDF and the passage lands in your notes, filed under the right section. Export the citations when it&apos;s time to write.</p>
        <div className="card-stack" aria-hidden="true">
          {SAMPLE_CARDS.map((p) => (
            <PaperCard key={p.id} paper={p} static />
          ))}
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <h2>Sign in</h2>
          <p>We&apos;ll email you a link. No password to remember.</p>
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
            <LoginForm next={next} initialError={error} />
          )}
        </div>
      </section>
    </main>
  );
}
