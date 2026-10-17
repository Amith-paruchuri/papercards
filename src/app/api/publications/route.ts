import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { dedupeWorks, enrichWorks, fromOpenAlexAuthors, fromOpenAlexWork, fromOrcidWorks, normalizeOrcid, splitName, type Work } from "@/lib/publications";

// GET /api/publications?source=orcid&id=0000-...        -> { works, name }
// GET /api/publications?source=openalex&id=A123...       -> { works }
// GET /api/publications?source=authors&q=Jane%20Doe       -> { authors }
// Public, key-free APIs (ORCID public API, OpenAlex). Signed-in users only.
const UA = "PaperCards/0.1 (reference manager; publication import)";
const ORCID = () => process.env.PAPERCARDS_ORCID_BASE || "https://pub.orcid.org";
const OPENALEX = () => process.env.PAPERCARDS_OPENALEX_BASE || "https://api.openalex.org";

async function getJson(url: string, accept = "application/json"): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: accept, "User-Agent": UA }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (res.status === 404) throw Object.assign(new Error("not found"), { status: 404 });
  if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { status: 502 });
  return res.json();
}

async function openAlexWorksByDoi(dois: string[]): Promise<Work[]> {
  const out: Work[] = [];
  for (let i = 0; i < dois.length; i += 50) {
    const chunk = dois.slice(i, i + 50).map((d) => `https://doi.org/${d}`);
    try {
      const json = (await getJson(`${OPENALEX()}/works?filter=doi:${encodeURIComponent(chunk.join("|"))}&per-page=50`)) as { results?: unknown[] };
      for (const w of json.results ?? []) {
        const n = fromOpenAlexWork(w as Parameters<typeof fromOpenAlexWork>[0]);
        if (n) out.push(n);
      }
    } catch {
      // enrichment is best effort
    }
  }
  return out;
}

async function openAlexWorksByAuthor(id: string): Promise<Work[]> {
  const out: Work[] = [];
  let cursor = "*";
  for (let page = 0; page < 5 && cursor; page++) {
    const json = (await getJson(`${OPENALEX()}/works?filter=author.id:${encodeURIComponent(id)}&per-page=200&cursor=${encodeURIComponent(cursor)}`)) as {
      results?: unknown[];
      meta?: { next_cursor?: string | null };
    };
    for (const w of json.results ?? []) {
      const n = fromOpenAlexWork(w as Parameters<typeof fromOpenAlexWork>[0]);
      if (n) out.push(n);
    }
    cursor = json.meta?.next_cursor ?? "";
  }
  return dedupeWorks(out).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const p = request.nextUrl.searchParams;
  const source = p.get("source");
  try {
    if (source === "orcid") {
      const id = normalizeOrcid(p.get("id") || "");
      if (!id) return NextResponse.json({ error: "That isn't a valid ORCID iD. It looks like 0000-0002-1825-0097." }, { status: 400 });
      const [worksJson, person] = await Promise.all([
        getJson(`${ORCID()}/v3.0/${id}/works`),
        getJson(`${ORCID()}/v3.0/${id}/person`).catch(() => null) as Promise<{ name?: { "given-names"?: { value?: string }; "family-name"?: { value?: string } } } | null>,
      ]);
      const base = fromOrcidWorks(worksJson);
      const extra = await openAlexWorksByDoi(base.map((w) => w.doi).filter((d): d is string => Boolean(d)));
      const name = [person?.name?.["given-names"]?.value, person?.name?.["family-name"]?.value].filter(Boolean).join(" ") || null;
      // Works OpenAlex doesn't know still list the ORCID owner, who is by definition an author.
      const works = enrichWorks(base, extra)
        .map((w) => (w.authors.length || !name ? w : { ...w, authors: [splitName(name)] }))
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      return NextResponse.json({ works, name, orcid: id });
    }
    if (source === "openalex") {
      const id = (p.get("id") || "").replace(/^https?:\/\/openalex\.org\//, "");
      if (!/^A\d+$/.test(id)) return NextResponse.json({ error: "Pick an author from the list first." }, { status: 400 });
      return NextResponse.json({ works: await openAlexWorksByAuthor(id) });
    }
    if (source === "authors") {
      const q = (p.get("q") || "").trim().slice(0, 120);
      if (q.length < 3) return NextResponse.json({ error: "Type at least 3 letters of your name." }, { status: 400 });
      const json = await getJson(`${OPENALEX()}/authors?search=${encodeURIComponent(q)}&per-page=10`);
      return NextResponse.json({ authors: fromOpenAlexAuthors(json) });
    }
    return NextResponse.json({ error: "Unknown source." }, { status: 400 });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404) return NextResponse.json({ error: "No public profile found with that iD. Check it on orcid.org." }, { status: 404 });
    console.error("Publications import failed:", e);
    return NextResponse.json({ error: "The publication service didn't answer. Try again in a moment." }, { status: 502 });
  }
}
