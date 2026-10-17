import type { Metadata } from "next";
import Link from "next/link";
import { OrigamiMark } from "@/components/Logo";
import { FeedbackForm } from "./FeedbackForm";
import type { Product } from "@/lib/feedback";

export const metadata: Metadata = {
  title: "Share feedback",
  description: "Tell us what's working and what isn't in PaperCards and Choti Copy. We read every message.",
};

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const initial: Product | null = product === "papercards" || product === "choticopy" || product === "both" ? product : null;
  return (
    <main className="fb-page" id="main">
      <div className="fb-sun" aria-hidden="true" />
      <header className="fb-top">
        <Link href="/" className="brand" aria-label="PaperCards home">
          <OrigamiMark size={30} />
          <span className="brand-name">PaperCards</span>
        </Link>
      </header>
      <section className="fb-hero">
        <p className="fb-kicker">Early access · help us shape it</p>
        <h1>
          Tell us what you <em>really</em> think.
        </h1>
        <p className="fb-lede">
          PaperCards and Choti Copy are brand new, and you&apos;re among the first people using them. A bug, a wish, a moment of confusion, or something you loved: it
          all helps. Two minutes is plenty.
        </p>
      </section>
      <section className="fb-card">
        <FeedbackForm initialProduct={initial} />
      </section>
      <footer className="fb-foot hint">
        We use what you send only to improve these apps. <Link href="/privacy">Privacy</Link>
      </footer>
    </main>
  );
}
