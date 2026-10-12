# PaperCards

> Your research brain. A reference and PDF manager for postdocs and senior researchers (a Zotero alternative), built around cards (papers) and decks (collections).

This file is the source of truth for this project. Read it before every task. Also read `AGENTS.md` (Next.js 16 notes) and, for any UI work, `DESIGN.md` (the visual system).

---

## 0. Hard rules (read first, never break)

### Rule 1: Isolation
PaperCards is a completely separate product from **Choti Copy** and **BAALANCE**.
- Never use, copy, or reference any Supabase project, keys, env files, migrations, OAuth clients, Razorpay settings, or code from Choti Copy or BAALANCE.
- Choti Copy's Supabase project ref is `nyxivqlpikoffdopfmei`. **Never connect to it.** If this string appears anywhere (env files, config, code, CLI link, logs), STOP immediately and tell the user.
- Do not open, read from, or import files in the Choti Copy or BAALANCE folders.
- Guards in code: `scripts/check-isolation.mjs` (runs before `dev`/`build`), `src/lib/supabase/env.ts`, `src/proxy.ts`. Keep them.

### Rule 2: PaperCards' own Supabase project and secrets
- PaperCards uses its own, new Supabase project, created by the user.
- `.env.local.example` lists the required variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- The user creates the project and fills `.env.local` themselves.
- Never print, log, echo, or commit real keys. Never paste key values into chat, code, tests, or docs. When a command needs a key, read it from `.env.local` inside the command without echoing it.
- `.env.local` (and all `.env*.local`) must stay in `.gitignore`.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only: never import it into client components, never prefix it with `NEXT_PUBLIC_`. (The app currently does not use it at all.)

### Working rules
- Inspect before writing code. Propose plans for large changes.
- Fix errors you find without waiting.
- The user has authorised applying migrations to the PaperCards Supabase project and deploying PaperCards to Vercel. Still ask before anything destructive (dropping tables, deleting user data or files, rewriting git history) and before anything involving payments or other products' accounts.
- Every database table has row-level security enabled with explicit policies. No table ships without RLS. Add RLS tests to `supabase/tests/rls_test.sql` for new tables.
- Commit after each working feature with a clear message. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` before committing.

---

## 1. Stack

- **Framework:** Next.js 16 (App Router, Turbopack) + TypeScript + React 19. Middleware is called **`src/proxy.ts`** in Next 16.
- **Backend:** Supabase (Postgres, Auth, Storage), PaperCards' own project only
- **Supabase client:** `@supabase/ssr` (`src/lib/supabase/client.ts` browser, `server.ts` server)
- **PDF:** `pdfjs-dist` v6 **legacy build** (`pdfjs-dist/legacy/build/pdf.mjs`; worker copied to `public/pdf.worker.min.mjs` by `scripts/copy-pdf-worker.mjs`). Do not switch to the modern build: it needs `Map#getOrInsertComputed`, which current Safari/Chrome releases lack, and PDFs stop opening.
- **Fonts:** Geist (UI), Newsreader (titles), JetBrains Mono (DOIs), self-hosted via `@fontsource-variable` (no Google Fonts requests)
- **Icons:** `@phosphor-icons/react` only
- **Styling:** plain CSS with tokens in `src/app/globals.css`; design rules in `DESIGN.md` ("Washi & Ai")
- **Tests:** `node --test` (pure libs in `tests/`), SQL RLS tests in `supabase/tests/`, UI checks via the mock backend in `tests/e2e/`
- **Dev server port: 3002** (`npm run dev` → `next dev -p 3002`). Do not use 3000/3001.

## 2. Setup and deploy runbook (for Claude Code on the user's Mac)

Run these in order. Steps 3 and 5 touch the user's Supabase/Vercel accounts and are pre-approved for the PaperCards project only.

1. `npm install`
2. Check `.env.local` exists and has the three variables filled (do not print values). Run `node scripts/check-isolation.mjs`; if it fails, STOP (rule 1).
3. **Apply the database migration** to the PaperCards project. Either:
   - **SQL editor (simplest):** open Supabase dashboard → SQL Editor → paste `supabase/migrations/20261013000000_init.sql` → Run. Or
   - **CLI:** `npx supabase login`, then `npx supabase link --project-ref <PaperCards ref from NEXT_PUBLIC_SUPABASE_URL>` (verify the ref is NOT `nyxivqlpikoffdopfmei`), then `npx supabase db push`.
   - Verify: Table Editor shows `papers, collections, collection_papers, tags, paper_tags, note_sections, highlights, profiles` (RLS enabled on all) and Storage shows a private `pdfs` bucket.
4. **Auth URLs:** Supabase → Authentication → URL Configuration: Site URL `http://localhost:3002`; Redirect URLs `http://localhost:3002/**` (add the Vercel URL `https://<app>.vercel.app/**` after step 6).
5. `npm run dev` → open http://localhost:3002 → sign in with an email magic link → add a paper by DOI and by PDF → highlight → export BibTeX.
6. **Deploy to Vercel:** `npx vercel login`, `npx vercel link` (new project named `papercards`, never reuse another product's project), add env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Production and Preview (`npx vercel env add …`, values piped from `.env.local`, never echoed), then `npx vercel --prod`. Add the production URL to Supabase redirect URLs (step 4) and set Site URL to it.

### Design tooling (install once in Claude Code on the Mac)
Third-party skills the user picked for frontend quality. Review each SKILL.md after installing; they are guidance, and `DESIGN.md` wins where they disagree.
- `npx skills add Leonxlnx/taste-skill` (anti-generic design rules; we follow its bans, not its landing-page layouts)
- `npx skills add vercel-labs/agent-skills --skill web-design-guidelines` (audit UI against Vercel's Web Interface Guidelines)
- `npx getdesign@latest add notion` and `npx getdesign@latest add linear.app` (reference DESIGN.md files; save them under `docs/design-refs/`, never over our `DESIGN.md`)
- Playwright is used for screenshots: `npx playwright install chromium` once.

### Local UI testing without Supabase
`node tests/e2e/mock-supabase.mjs 54321` starts an in-memory stand-in for Supabase (auth, the PostgREST subset we use, storage) seeded with a demo library. Point a scratch `.env.local` at `http://localhost:54321` with any anon key, run `npm run dev`, and sign in by setting the `sb-localhost-auth-token` cookie (see the mock's `sessionFor`). `MOCK_EMPTY=1` gives an empty library; `MOCK_PDF=/path/file.pdf` attaches a PDF to the first card. Never use the mock for anything but local testing.

## 3. Architecture

- **Data access:** all reads/writes go through `src/lib/data.ts` (client-side, Supabase JS, protected by RLS). UI components never call Supabase directly (exceptions: auth in `LoginForm`, small membership reads in `PaperView`).
- **Auth:** email magic link (`/login`) → `/auth/callback` (PKCE `code` or `token_hash`) → session cookies refreshed in `src/proxy.ts`, which also redirects signed-out users to `/login`.
- **Metadata:** `GET /api/metadata/doi?doi=` (signed-in only) → Crossref, falling back to doi.org CSL-JSON (DataCite). PDF ingest (`src/lib/ingest.ts`): SHA-256 duplicate check → pdf.js scans first 3 pages + XMP for a DOI → lookup → create card → upload PDF. Without a DOI, title/authors are guessed from first-page layout (`src/lib/pdf/extract.ts`).
- **PDF storage:** private bucket `pdfs`, path `{user_id}/{paper_id}.pdf`, 50 MB limit, PDFs only.
- **Highlights:** stored with page + normalised rects (0..1). Highlighting into a section appends `<li data-hl="{highlight id}">text</li>` to that section's HTML; clicking the bullet scrolls the viewer to the highlight and flashes it.
- **Notes:** `note_sections` rows per paper (default Introduction / Methods / Results / Discussion created by DB trigger), renamable, recolourable, reorderable; HTML sanitised by `src/lib/sanitize.ts`. Images are pasted inline as downscaled data URLs (move to a storage bucket later).
- **Exports:** BibTeX / RIS / CSV (`src/lib/citations.ts`, `src/lib/download.ts`); per-card combined summary prints to PDF.
- **Legacy import:** `/import` reads the prototype's `papercards_v1` localStorage export (decks → collections, labels → tags, notes, highlights, PDFs). Idempotent via `papers.legacy_id`.

## 4. Database schema (migration `supabase/migrations/20261013000000_init.sql`)

| Table | Purpose |
|---|---|
| `profiles` | one row per auth user (trigger on signup) |
| `papers` | the card: bibliographic fields, `authors` jsonb `[{family, given}]`, status `to_read/reading/read/annotated`, priority 0–3, study_type, site, subjects[], pdf_path/sha256/size, legacy_id, `search` tsvector (trigger) |
| `collections` | decks; nestable via `parent_id`; editable `summary` |
| `collection_papers` | many-to-many |
| `tags`, `paper_tags` | labels, unique per user case-insensitively |
| `note_sections` | per-paper summary boxes (title, color, position, content_html) |
| `highlights` | page, text, color, rects jsonb, optional section |

RLS: every table `owner_id = auth.uid()` for select/insert/update/delete; join tables and child rows additionally require the referenced paper/collection/tag/section to belong to the same user (`owns_*` helper functions). Storage policies restrict `pdfs` objects to the `{auth.uid()}/` folder. Unique DOI per user. Tested in `supabase/tests/rls_test.sql` (two-user isolation).

## 5. Product

### Problem
- Every researcher or postdoc wants their own research paper database: easy to organise, free, storable and shareable across people and devices, holding their own papers and annotations.
- Notion, Excel, and Obsidian are not built for this. PDF extraction tools target SRMA extraction; ResearchGate and Google Scholar target profiles and community, not personal knowledge work.

### Vision
- PaperCards is your research brain: a custom research database for easy storage and reproducibility.
- Built for postdocs through senior researchers, so cost matters: core features stay free.

### What it is NOT
- NOT a tool for extracting or screening articles for systematic reviews / meta-analyses.
- NOT a "chat with your PDF" tool.
- NOT a fully paid product.

### Status against the spec (MVP built 13 Oct 2026)
| Feature | Status |
|---|---|
| Cards and decks (collections), drag cards onto collections | Done |
| Editable sectioned summary, renamable sections, images | Done |
| PDF viewer with highlighting into sections, click bullet → jump | Done |
| Deck-level summary | Partial: editable summary text per collection |
| Export: BibTeX, RIS, CSV (Excel), print card summary to PDF | Done |
| Tags (labels) and filters (status, collection, tag, year range, study type, has PDF) | Done |
| Full-text search (title, authors, abstract, journal, DOI, subjects) with prefix matching | Done |
| To-read queue with priority sort | Done |
| Add by DOI (Crossref/DataCite), by PDF (auto DOI detection, batch drop), manual | Done |
| Command menu (⌘K): jump to any paper or collection, run actions | Done |
| First-run onboarding with drop zone and sample papers | Done |
| Redesign: "Washi & Ai" system, folded-card status, note-coverage strip, dark mode, mobile | Done |
| Legacy prototype import | Done |
| Sharing cards/decks, shared lab decks | Next |
| Label graph (Obsidian-style) | Next |
| Excel import, Google Scholar alert ingestion | Later |
| Desktop app (Tauri), mobile | Later |

### Next up (proposed order)
1. Share a deck read-only by link (new `shares` table + RLS), and "share without notes" option.
2. Label/collection graph view (force-directed).
3. Deck summary auto-compiled from member cards (counts by study type/year + per-card one-liners) and deck PDF export.
4. Notes images → storage bucket; drag-select figure capture from PDF.
5. Excel/CSV import with column mapping; BibTeX/RIS import (for Zotero/Mendeley migrants).
6. PWA install + offline cache; then Tauri desktop.

### Visual identity
See `DESIGN.md`. In short: washi surfaces, sumi ink, indigo accent, vermilion seal; the folded index card is the signature element; section colours Intro `#5ec4ee`, Methods `#7ed67e`, Results `#f0c463`, Discussion `#f0879b`.

## 6. Legacy prototype

`legacy/paper-cards-research.html` is the original single-file prototype. Never edit it. Its data can be brought in through `/import`.
