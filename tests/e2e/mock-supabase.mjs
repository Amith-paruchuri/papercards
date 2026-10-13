// In-memory stand-in for Supabase (auth + PostgREST subset + storage) used ONLY for local UI testing
// and screenshots when the real PaperCards project isn't reachable. Never used in production.
// Usage: node tests/e2e/mock-supabase.mjs [port]   (then run Next with NEXT_PUBLIC_SUPABASE_URL=http://localhost:<port>)
import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const PORT = Number(process.argv[2] || 54321);
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const db = { profiles: [], papers: [], collections: [], collection_papers: [], tags: [], paper_tags: [], note_sections: [], highlights: [] };
const files = new Map(); // storage path -> Buffer
const DEFAULT_SECTIONS = [
  ["Introduction", "#5ec4ee"],
  ["Methods", "#7ed67e"],
  ["Results", "#f0c463"],
  ["Discussion", "#f0879b"],
];
const UNIQUE = {
  papers: [(r) => (r.doi ? `${r.owner_id}|${r.doi}` : null), (r) => (r.legacy_id ? `L|${r.owner_id}|${r.legacy_id}` : null)],
  tags: [(r) => `${r.owner_id}|${String(r.name).toLowerCase()}`],
  collection_papers: [(r) => `${r.collection_id}|${r.paper_id}`],
  paper_tags: [(r) => `${r.paper_id}|${r.tag_id}`],
};
const DEFAULTS = {
  papers: () => ({ title: "Untitled", authors: [], year: null, journal: null, volume: null, issue: null, pages: null, publisher: null, doi: null, url: null, abstract: null, item_type: "article", study_type: null, site: null, subjects: [], status: "to_read", priority: 0, pdf_path: null, pdf_sha256: null, pdf_size: null, legacy_id: null }),
  collections: () => ({ parent_id: null, summary: "", position: 0 }),
  tags: () => ({ color: null }),
  note_sections: () => ({ title: "Notes", color: null, position: 0, content_html: "" }),
  highlights: () => ({ section_id: null, text: "", color: null, rects: [] }),
  collection_papers: () => ({ added_at: now() }),
  paper_tags: () => ({}),
  profiles: () => ({}),
};

function insertRow(table, row, uid) {
  const r = { ...DEFAULTS[table](), ...row };
  if (table !== "collection_papers" && table !== "paper_tags" && !r.id) r.id = randomUUID();
  if (!r.owner_id && table !== "profiles") r.owner_id = uid;
  if (table !== "profiles" && r.owner_id !== uid) throw rls();
  // FK ownership checks (mirror the RLS policies)
  const owns = (t, id) => db[t].some((x) => x.id === id && x.owner_id === uid);
  if ((table === "collection_papers" || table === "paper_tags" || table === "note_sections" || table === "highlights") && !owns("papers", r.paper_id)) throw rls();
  if (table === "collection_papers" && !owns("collections", r.collection_id)) throw rls();
  if (table === "paper_tags" && !owns("tags", r.tag_id)) throw rls();
  if (table === "highlights" && r.section_id && !owns("note_sections", r.section_id)) throw rls();
  for (const key of UNIQUE[table] ?? []) {
    const k = key(r);
    if (k && db[table].some((x) => key(x) === k)) {
      const e = new Error("duplicate key value violates unique constraint");
      e.status = 409;
      e.code = "23505";
      throw e;
    }
  }
  r.created_at ??= now();
  if ("updated_at" in r || ["papers", "collections", "note_sections", "profiles"].includes(table)) r.updated_at = now();
  db[table].push(r);
  if (table === "papers") {
    DEFAULT_SECTIONS.forEach(([title, color], i) => insertRow("note_sections", { paper_id: r.id, title, color, position: i }, uid));
  }
  return r;
}

function rls() {
  const e = new Error("new row violates row-level security policy");
  e.status = 403;
  e.code = "42501";
  return e;
}

function deleteRows(table, rows) {
  for (const r of rows) {
    db[table] = db[table].filter((x) => x !== r);
    if (table === "papers") {
      for (const t of ["note_sections", "highlights", "paper_tags", "collection_papers"]) db[t] = db[t].filter((x) => x.paper_id !== r.id);
    }
    if (table === "collections") {
      db.collection_papers = db.collection_papers.filter((x) => x.collection_id !== r.id);
      db.collections.forEach((c) => c.parent_id === r.id && (c.parent_id = null));
    }
    if (table === "tags") db.paper_tags = db.paper_tags.filter((x) => x.tag_id !== r.id);
    if (table === "note_sections") db.highlights.forEach((h) => h.section_id === r.id && (h.section_id = null));
  }
}

// ---------------------------------------------------------------------------
// PostgREST subset
// ---------------------------------------------------------------------------
function splitTop(s) {
  const out = [];
  let depth = 0,
    cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function project(table, rawRow, select) {
  const row = table === "note_sections" ? { ...rawRow, has_notes: Boolean(rawRow.content_html && rawRow.content_html.trim()) } : rawRow;
  if (!select || select === "*") return { ...row };
  const out = {};
  for (const part of splitTop(select)) {
    const m = part.match(/^(\w+)\((.*)\)$/);
    if (m) {
      const [, rel, cols] = m;
      const fk = table.replace(/s$/, "") + "_id";
      const children = (db[rel] ?? []).filter((c) => c[fk] === row.id);
      if (cols === "count") out[rel] = [{ count: children.length }];
      else out[rel] = children.map((c) => project(rel, c, cols));
    } else if (part === "*") Object.assign(out, row);
    else out[part] = row[part];
  }
  return out;
}

function tokens(s) {
  return String(s ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function matchFilter(row, key, raw) {
  let neg = false;
  let v = raw;
  if (v.startsWith("not.")) {
    neg = true;
    v = v.slice(4);
  }
  const dot = v.indexOf(".");
  const op = v.slice(0, dot);
  const val = v.slice(dot + 1);
  let ok;
  const cell = row[key];
  if (op === "eq") ok = String(cell) === val;
  else if (op === "neq") ok = String(cell) !== val;
  else if (op === "in") ok = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(cell));
  else if (op === "is") ok = val === "null" ? cell === null || cell === undefined : String(cell) === val;
  else if (op === "ilike") ok = new RegExp("^" + val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*") + "$", "i").test(String(cell ?? ""));
  else if (op.startsWith("fts")) {
    const hay = tokens([row.title, (row.authors || []).map((a) => `${a.given ?? ""} ${a.family}`).join(" "), row.abstract, row.journal, row.doi, row.year, row.site, (row.subjects || []).join(" ")].join(" "));
    const terms = val.split("&").map((t) => t.trim().replace(/:\*$/, "").toLowerCase()).filter(Boolean);
    ok = terms.every((t) => hay.some((h) => h.startsWith(t)));
  } else ok = true;
  return neg ? !ok : ok;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function query(table, url, uid) {
  let rows = db[table].filter((r) => (table === "profiles" ? r.id === uid : r.owner_id === uid));
  for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) rows = rows.filter((r) => matchFilter(r, k, v));
  return rows;
}

function sortRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(",").map((o) => {
    const [col, dir] = o.split(".");
    return { col, desc: dir === "desc" };
  });
  return rows.slice().sort((a, b) => {
    for (const { col, desc } of keys) {
      const x = a[col] ?? "",
        y = b[col] ?? "";
      if (x < y) return desc ? 1 : -1;
      if (x > y) return desc ? -1 : 1;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function makeJwt(uid, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: uid, email, is_anonymous: Boolean(users.get(uid)?.anon), role: "authenticated", aud: "authenticated", exp, iat: exp - 3600 * 24 })}.mock-signature`;
}
function uidFrom(req) {
  const auth = req.headers.authorization || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString());
    return payload.role === "authenticated" ? payload.sub : null;
  } catch {
    return null;
  }
}
const users = new Map();
function userJson(uid) {
  const u = users.get(uid);
  return { id: uid, aud: "authenticated", role: "authenticated", email: u?.email ?? "", is_anonymous: Boolean(u?.anon), app_metadata: { provider: u?.anon ? "anonymous" : "email" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
}
export function sessionFor(uid) {
  const u = users.get(uid);
  return { access_token: makeJwt(uid, u.email), token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: "mock-refresh-" + uid, user: userJson(uid) };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function send(res, status, data, headers = {}) {
  const isBuf = Buffer.isBuffer(data);
  res.writeHead(status, { "Content-Type": isBuf ? "application/octet-stream" : "application/json", ...headers });
  res.end(isBuf ? data : data === undefined ? "" : JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, x-supabase-api-version");
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // ---- auth
    if (p === "/auth/v1/.well-known/jwks.json") return send(res, 200, { keys: [] });
    if (p === "/auth/v1/otp") return send(res, 200, {});
    if (p === "/auth/v1/signup" && req.method === "POST") {
      // Anonymous sign-in (no email in the body).
      const b = JSON.parse((await body(req)).toString() || "{}");
      if (b.email) return send(res, 400, { msg: "mock supports anonymous sign-up only" });
      const nid = randomUUID();
      users.set(nid, { email: undefined, anon: true });
      return send(res, 200, sessionFor(nid));
    }
    if (p === "/auth/v1/logout") return send(res, 204);
    if (p === "/auth/v1/user") {
      const uid = uidFrom(req);
      return uid && users.has(uid) ? send(res, 200, userJson(uid)) : send(res, 401, { code: 401, msg: "invalid JWT" });
    }
    if (p === "/auth/v1/token") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const uid = String(b.refresh_token || "").replace("mock-refresh-", "");
      return users.has(uid) ? send(res, 200, sessionFor(uid)) : send(res, 400, { error: "invalid_grant" });
    }

    const uid = uidFrom(req);
    // ---- storage
    if (p.startsWith("/storage/v1/object/")) {
      if (!uid) return send(res, 401, { message: "unauthorized" });
      const rest = decodeURIComponent(p.slice("/storage/v1/object/".length)).replace(/^authenticated\//, "");
      const [bucket, ...pathParts] = rest.split("/");
      const path = pathParts.join("/");
      if (req.method === "DELETE") {
        const b = JSON.parse((await body(req)).toString() || "{}");
        for (const pre of b.prefixes || []) if (pre.split("/")[0] === uid) files.delete(`${bucket}/${pre}`);
        return send(res, 200, (b.prefixes || []).map((name) => ({ name })));
      }
      if (path.split("/")[0] !== uid) return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      if (req.method === "POST" || req.method === "PUT") {
        const raw = await body(req);
        const ct = req.headers["content-type"] || "";
        let buf = raw;
        if (ct.startsWith("multipart/form-data")) {
          const fd = await new Request("http://x", { method: "POST", headers: { "content-type": ct }, body: raw }).formData();
          for (const [, v] of fd) if (typeof v !== "string") buf = Buffer.from(await v.arrayBuffer());
        }
        files.set(`${bucket}/${path}`, buf);
        return send(res, 200, { Key: `${bucket}/${path}`, Id: randomUUID() });
      }
      const f = files.get(`${bucket}/${path}`);
      return f ? send(res, 200, f, { "Content-Type": "application/pdf" }) : send(res, 404, { message: "Object not found" });
    }

    // ---- rest
    const m = p.match(/^\/rest\/v1\/(\w+)$/);
    if (m) {
      const table = m[1];
      if (!db[table]) return send(res, 404, { code: "42P01", message: `relation "public.${table}" does not exist` });
      if (!uid) return send(res, 401, { code: "42501", message: "permission denied" });
      const select = url.searchParams.get("select");
      const prefer = req.headers.prefer || "";
      const single = (req.headers.accept || "").startsWith("application/vnd.pgrst.object+json");
      let rows;
      if (req.method === "GET" || req.method === "HEAD") {
        rows = sortRows(query(table, url, uid), url.searchParams.get("order"));
        const limit = url.searchParams.get("limit");
        if (limit) rows = rows.slice(0, Number(limit));
      } else if (req.method === "POST") {
        const parsed = JSON.parse((await body(req)).toString() || "[]");
        const list = Array.isArray(parsed) ? parsed : [parsed];
        rows = [];
        for (const r of list) {
          try {
            rows.push(insertRow(table, r, uid));
          } catch (e) {
            if (e.code === "23505" && /ignore-duplicates/.test(prefer)) continue;
            throw e;
          }
        }
      } else if (req.method === "PATCH") {
        const patch = JSON.parse((await body(req)).toString() || "{}");
        rows = query(table, url, uid);
        for (const r of rows) {
          if (table === "papers" && patch.doi && db.papers.some((x) => x !== r && x.owner_id === uid && x.doi === patch.doi)) {
            const e = new Error("duplicate key value violates unique constraint");
            e.status = 409;
            e.code = "23505";
            throw e;
          }
          Object.assign(r, patch);
          if ("updated_at" in r) r.updated_at = now();
        }
      } else if (req.method === "DELETE") {
        rows = query(table, url, uid);
        deleteRows(table, rows);
      }
      const wantRows = req.method === "GET" || /return=representation/.test(prefer);
      if (!wantRows) return send(res, 204);
      const out = rows.map((r) => project(table, r, select));
      if (single) {
        if (out.length !== 1) return send(res, 406, { code: "PGRST116", details: `The result contains ${out.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
        return send(res, 200, out[0]);
      }
      return send(res, 200, out, { "Content-Range": `0-${Math.max(out.length - 1, 0)}/${out.length}` });
    }
    return send(res, 404, { message: `mock: no route ${req.method} ${p}` });
  } catch (e) {
    return send(res, e.status || 500, { code: e.code || "XX000", message: e.message, details: null, hint: null });
  }
});

// ---------------------------------------------------------------------------
// Seed: one demo researcher with a realistic small library (test fixtures only)
// ---------------------------------------------------------------------------
export const DEMO_UID = "11111111-1111-4111-8111-111111111111";
users.set(DEMO_UID, { email: "demo@papercards.test" });
db.profiles.push({ id: DEMO_UID, display_name: "demo", created_at: now(), updated_at: now() });

function seed() {
  const u = DEMO_UID;
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const col = (name, summary = "") => insertRow("collections", { name, summary }, u);
  const tag = (name) => insertRow("tags", { name }, u);
  const cPath = col("Computational pathology", "Weakly supervised and foundation-model approaches to whole slide images, with an eye on Indian OSCC cohorts.");
  const cFound = col("Foundation models");
  const cJournal = col("Journal club, October");
  const tWsi = tag("WSI"),
    tMil = tag("MIL"),
    tProt = tag("protein structure"),
    tGen = tag("genome editing"),
    tTrans = tag("transformers"),
    tOscc = tag("OSCC");
  const P = [
    { title: "Clinical-grade computational pathology using weakly supervised deep learning on whole slide images", authors: [{ family: "Campanella", given: "Gabriele" }, { family: "Hanna", given: "Matthew G." }, { family: "Fuchs", given: "Thomas J." }], year: 2019, journal: "Nature Medicine", volume: "25", pages: "1301-1309", doi: "10.1038/s41591-019-0508-1", status: "annotated", priority: 3, study_type: "original", subjects: ["pathology"], abstract: "The development of decision support systems for pathology and their deployment in clinical practice have been hindered by the need for large manually annotated datasets. We present a multiple instance learning-based deep learning system that uses only the reported diagnoses as labels for training.", cols: [cPath, cJournal], tags: [tWsi, tMil], ago: 0.1, pdf: true },
    { title: "Deep learning can predict microsatellite instability directly from histology in gastrointestinal cancer", authors: [{ family: "Kather", given: "Jakob Nikolas" }, { family: "Pearson", given: "Alexander T." }], year: 2019, journal: "Nature Medicine", volume: "25", pages: "1054-1056", doi: "10.1038/s41591-019-0462-y", status: "read", priority: 2, study_type: "original", abstract: "Microsatellite instability determines whether patients with gastrointestinal cancer respond exceptionally well to immunotherapy. Here we show that deep residual learning can predict MSI directly from H&E histology.", cols: [cPath], tags: [tWsi], ago: 1 },
    { title: "Highly accurate protein structure prediction with AlphaFold", authors: [{ family: "Jumper", given: "John" }, { family: "Evans", given: "Richard" }, { family: "Hassabis", given: "Demis" }], year: 2021, journal: "Nature", volume: "596", pages: "583-589", doi: "10.1038/s41586-021-03819-2", status: "reading", priority: 1, study_type: "original", abstract: "Proteins are essential to life, and understanding their structure can facilitate a mechanistic understanding of their function. Here we provide the first computational method that can regularly predict protein structures with atomic accuracy.", cols: [cFound], tags: [tProt], ago: 2 },
    { title: "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity", authors: [{ family: "Jinek", given: "Martin" }, { family: "Chylinski", given: "Krzysztof" }, { family: "Charpentier", given: "Emmanuelle" }, { family: "Doudna", given: "Jennifer A." }], year: 2012, journal: "Science", volume: "337", pages: "816-821", doi: "10.1126/science.1225829", status: "read", priority: 0, study_type: "original", abstract: "Clustered regularly interspaced short palindromic repeats (CRISPR)/CRISPR-associated (Cas) systems provide bacteria and archaea with adaptive immunity against viruses and plasmids.", cols: [cJournal], tags: [tGen], ago: 4 },
    { title: "Attention is all you need", authors: [{ family: "Vaswani", given: "Ashish" }, { family: "Shazeer", given: "Noam" }, { family: "Parmar", given: "Niki" }], year: 2017, journal: "Advances in Neural Information Processing Systems", volume: "30", doi: "10.48550/arxiv.1706.03762", item_type: "conference", status: "annotated", priority: 2, study_type: "original", abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.", cols: [cFound], tags: [tTrans], ago: 6 },
    { title: "Data-efficient and weakly supervised computational pathology on whole-slide images", authors: [{ family: "Lu", given: "Ming Y." }, { family: "Williamson", given: "Drew F. K." }, { family: "Mahmood", given: "Faisal" }], year: 2021, journal: "Nature Biomedical Engineering", volume: "5", pages: "555-570", doi: "10.1038/s41551-020-00682-w", status: "to_read", priority: 3, study_type: "original", abstract: "Deep-learning methods for computational pathology require either manual annotation of gigapixel whole-slide images or large datasets of slides with slide-level labels. CLAM uses attention-based learning to identify subregions of high diagnostic value.", cols: [cPath], tags: [tWsi, tMil], ago: 0.5 },
    { title: "Oral squamous cell carcinoma in India: an overview of epidemiology and risk factors", authors: [{ family: "Sharma", given: "R." }], year: 2023, journal: "Indian Journal of Cancer", status: "to_read", priority: 1, study_type: "review", site: "India", abstract: null, cols: [cPath], tags: [tOscc], ago: 0.3 },
    { title: "Deep residual learning for image recognition", authors: [{ family: "He", given: "Kaiming" }, { family: "Zhang", given: "Xiangyu" }, { family: "Ren", given: "Shaoqing" }, { family: "Sun", given: "Jian" }], year: 2016, journal: "IEEE Conference on Computer Vision and Pattern Recognition", pages: "770-778", doi: "10.1109/cvpr.2016.90", item_type: "conference", status: "read", priority: 0, study_type: "original", abstract: "Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously.", cols: [cFound], tags: [], ago: 9 },
  ];
  for (const x of P) {
    const { cols, tags, ago, pdf, ...fields } = x;
    const paper = insertRow("papers", fields, u);
    paper.created_at = daysAgo(ago + 1);
    paper.updated_at = daysAgo(ago);
    cols.forEach((c) => insertRow("collection_papers", { collection_id: c.id, paper_id: paper.id }, u));
    tags.forEach((t) => insertRow("paper_tags", { paper_id: paper.id, tag_id: t.id }, u));
    const secs = db.note_sections.filter((s) => s.paper_id === paper.id);
    if (x.status === "annotated" || x.status === "read") {
      secs[0].content_html = "<ul><li>Manual pixel-level annotation does not scale to clinical slide volumes.</li></ul>";
      secs[1].content_html = "<ul><li>Multiple instance learning with slide-level labels from pathology reports.</li></ul>";
      if (x.status === "annotated") secs[2].content_html = "<ul><li>AUC 0.98 for prostate cancer on the held-out test set.</li></ul>";
    }
    if (pdf && existsSync(process.env.MOCK_PDF || "")) {
      const path = `${u}/${paper.id}.pdf`;
      files.set(`pdfs/${path}`, readFileSync(process.env.MOCK_PDF));
      Object.assign(paper, { pdf_path: path, pdf_size: files.get(`pdfs/${path}`).length });
    }
  }
}
if (process.env.MOCK_EMPTY !== "1") seed();

server.listen(PORT, () => console.log(`mock supabase on http://localhost:${PORT} (demo user ${DEMO_UID})`));
