import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Brand } from "@/components/Logo";
import type { FeedbackRow } from "@/lib/feedback";
import { FeedbackInbox } from "./FeedbackInbox";

export const metadata: Metadata = { title: "Feedback inbox", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function FeedbackInboxPage() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/feedback");
  const { data: isAdmin } = await supabase.rpc("is_feedback_admin");
  if (!isAdmin) {
    return (
      <main className="simple-page" id="main">
        <div className="simple-card">
          <Brand href="/" />
          <h1>Not available</h1>
          <p className="hint">This page is only for the PaperCards team. Want to share something?</p>
          <Link className="btn" href="/feedback">
            Share feedback
          </Link>
        </div>
      </main>
    );
  }
  const { data, error } = await supabase.from("feedback").select("*").order("created_at", { ascending: false }).limit(1000);
  return (
    <main className="inbox-page" id="main">
      <header className="inbox-top">
        <Brand href="/" />
        <span className="grow" />
        <Link className="btn ghost small" href="/feedback" target="_blank">
          Open the public form
        </Link>
        <Link className="btn quiet small" href="/">
          Library
        </Link>
      </header>
      {error ? (
        <div className="notice" role="alert">
          Couldn&apos;t load feedback: {error.message}
        </div>
      ) : (
        <FeedbackInbox initial={(data ?? []) as FeedbackRow[]} />
      )}
    </main>
  );
}
