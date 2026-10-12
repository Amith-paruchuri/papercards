import type { Metadata } from "next";
import { isConfigured } from "@/lib/supabase/env";
import { LoginForm } from "./LoginForm";
import { OrigamiMark } from "@/components/Logo";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const configured = isConfigured();
  const forbidden = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").includes("nyxivqlpikoffdopfmei");
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <OrigamiMark size={42} />
        <h1>PaperCards</h1>
        <p>Your research brain. Keep your papers, PDFs, highlights and notes in one place, and export citations anywhere.</p>
        {forbidden ? (
          <div className="notice">
            <strong>Stopped.</strong> <code>.env.local</code> points at another product&apos;s Supabase project. PaperCards must use its own project.
          </div>
        ) : !configured ? (
          <div className="notice">
            <strong>Almost there.</strong> Copy <code>.env.local.example</code> to <code>.env.local</code>, fill in the PaperCards Supabase URL and anon key,
            then restart <code>npm run dev</code>.
          </div>
        ) : (
          <LoginForm next={next} initialError={error} />
        )}
      </div>
    </main>
  );
}
