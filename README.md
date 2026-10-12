# PaperCards

Your research brain: a reference and PDF manager for researchers. Cards for papers, decks for collections, PDF highlights that flow into sectioned notes, and one-click BibTeX/RIS export.

## Quick start

```bash
npm install
cp .env.local.example .env.local   # fill in your PaperCards Supabase URL + anon key
npm run dev                         # http://localhost:3002
```

Apply `supabase/migrations/20261013000000_init.sql` to your Supabase project first (SQL editor or `npx supabase db push`). Full runbook, rules and architecture: see [CLAUDE.md](CLAUDE.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3002 (checks Supabase isolation first) |
| `npm run build` / `npm start` | Production build / serve on 3002 |
| `npm test` | Unit tests (DOI parsing, Crossref mapping, BibTeX/RIS) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
