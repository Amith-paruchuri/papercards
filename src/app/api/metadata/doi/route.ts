import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeDoi } from "@/lib/doi";
import { crossrefToMeta, type CrossrefWork } from "@/lib/crossref";

const UA = "PaperCards/0.1 (reference manager; metadata lookup)";

type CslJson = Omit<CrossrefWork, "title" | "container-title"> & {
  title?: string | string[];
  "container-title"?: string | string[];
};

function toArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

// GET /api/metadata/doi?doi=10.xxxx/yyyy  ->  PaperMeta
// Crossref first; falls back to doi.org content negotiation (covers DataCite DOIs such as arXiv/Zenodo).
export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const doi = normalizeDoi(request.nextUrl.searchParams.get("doi"));
  if (!doi) return NextResponse.json({ error: "That doesn't look like a DOI (it should start with 10.)." }, { status: 400 });

  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { message: CrossrefWork };
      return NextResponse.json({ meta: crossrefToMeta(body.message), source: "crossref" });
    }
  } catch {
    // fall through to doi.org
  }

  try {
    const res = await fetch(`https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, "/")}`, {
      headers: { "User-Agent": UA, Accept: "application/vnd.citationstyles.csl+json" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
      cache: "no-store",
    });
    if (res.ok) {
      const csl = (await res.json()) as CslJson;
      const meta = crossrefToMeta({
        ...csl,
        title: toArray(csl.title),
        "container-title": toArray(csl["container-title"]),
        DOI: csl.DOI || doi,
      });
      return NextResponse.json({ meta, source: "doi.org" });
    }
    if (res.status === 404) {
      return NextResponse.json({ error: "No record found for this DOI." }, { status: 404 });
    }
  } catch {
    // handled below
  }
  return NextResponse.json({ error: "Metadata service unavailable. You can still add the paper manually." }, { status: 502 });
}
