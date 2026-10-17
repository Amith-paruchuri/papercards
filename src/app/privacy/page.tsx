import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Logo";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <main className="simple-page legal" id="main">
      <article className="simple-card wide">
        <Brand href="/" />
        <h1>Privacy policy</h1>
        <p className="hint">Last updated 17 October 2026</p>
        <h2>What we keep</h2>
        <ul>
          <li>Your account: email address, and a password stored only as a secure hash by our sign-in provider (Supabase). If you use Google, we receive your email and name from Google.</li>
          <li>Your library: papers, PDFs, highlights, notes, tags and decks you create. These are private to your account and protected by row-level security.</li>
          <li>Feedback you send, including your name and email only if you choose to add them.</li>
        </ul>
        <h2>How it&apos;s used</h2>
        <p>Only to run PaperCards for you and to improve it. We don&apos;t sell your data and don&apos;t show ads.</p>
        <h2>Services we rely on</h2>
        <ul>
          <li>Supabase (database, file storage and sign-in) and Vercel (hosting).</li>
          <li>Google Gemini, only when you use an AI feature: the highlighted passages or paper titles involved are sent for that request.</li>
          <li>Crossref, OpenAlex and ORCID, to look up public paper details when you add a DOI or link your publications.</li>
        </ul>
        <h2>Your choices</h2>
        <p>
          You can export your citations and notes at any time. To delete your account and everything in it, <Link href="/feedback?product=papercards">send us a message</Link>{" "}
          from the email on your account and we&apos;ll remove it.
        </p>
      </article>
    </main>
  );
}
