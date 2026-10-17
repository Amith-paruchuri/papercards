import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Logo";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <main className="simple-page legal" id="main">
      <article className="simple-card wide">
        <Brand href="/" />
        <h1>Terms of use</h1>
        <p className="hint">Last updated 17 October 2026</p>
        <p>PaperCards is an early-access tool for keeping research papers, highlights and notes. By creating an account you agree to these terms.</p>
        <h2>Your content</h2>
        <p>
          The PDFs, notes and highlights you add stay yours. You give us permission only to store and process them so the app can work for you (for example,
          showing your library, or sending a passage to our AI provider when you ask for an AI note). Only upload files you have the right to use.
        </p>
        <h2>Early access</h2>
        <p>
          PaperCards is new and changing quickly. Features may change, and there may be bugs. Keep your own copies of anything important; you can export citations
          and notes at any time. We may pause or end the service, and we&apos;ll give notice where we can.
        </p>
        <h2>Fair use</h2>
        <p>Don&apos;t misuse the service: no attempts to access other people&apos;s data, overload the system, or use it for anything unlawful. We may suspend accounts that do.</p>
        <h2>AI features</h2>
        <p>AI notes and suggestions can be wrong. Check them against the paper before you rely on them, especially for clinical or published work.</p>
        <h2>No warranty</h2>
        <p>The service is provided as is, without warranties. To the extent the law allows, we aren&apos;t liable for indirect losses or lost data.</p>
        <h2>Contact</h2>
        <p>
          Questions or problems: <Link href="/feedback?product=papercards">send us a message</Link>.
        </p>
      </article>
    </main>
  );
}
