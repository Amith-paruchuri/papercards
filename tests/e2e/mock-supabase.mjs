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
  papers: () => ({ title: "Untitled", authors: [], year: null, journal: null, volume: null, issue: null, pages: null, publisher: null, doi: null, url: null, abstract: null, item_type: "article", study_type: null, site: null, subjects: [], status: "to_read", priority: 0, pdf_path: null, pdf_sha256: null, pdf_size: null, legacy_id: null, is_mine: false, deleted_at: null }),
  collections: () => ({ parent_id: null, summary: "", position: 0 }),
  tags: () => ({ color: null }),
  note_sections: () => ({ title: "Notes", color: null, position: 0, content_html: "" }),
  highlights: () => ({ section_id: null, text: "", color: null, rects: [] }),
  collection_papers: () => ({ added_at: now() }),
  paper_tags: () => ({}),
  profiles: () => ({ orcid: null, scholar_url: null, researchgate_url: null, openalex_id: null, publications_synced_at: null }),
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
  else if (op === "lt") ok = cell != null && String(cell) < val;
  else if (op === "gt") ok = cell != null && String(cell) > val;
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
const feedback = [];
function userJson(uid) {
  const u = users.get(uid);
  return { id: uid, aud: "authenticated", role: "authenticated", email: u?.email ?? "", is_anonymous: Boolean(u?.anon), identities: u?.anon ? [] : [{ provider: "email" }], app_metadata: { provider: u?.anon ? "anonymous" : "email" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
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
    // ---- fake Anthropic Messages API (for "Rewrite with AI" tests; set ANTHROPIC_BASE_URL to this server)
    if (p === "/v1/messages" && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const user = b.messages?.[0]?.content || "";
      const passages = JSON.parse(user.slice(user.indexOf("[")));
      const clean = /Keep the author's wording/.test(b.system || "");
      const items = passages.map((x) => ({ id: x.id, text: clean ? x.text : x.text.split(/\s+/).slice(0, 9).join(" ").replace(/[,.;:]$/, "") + " (AI note)." }));
      return send(res, 200, { content: [{ type: "text", text: "```json\n" + JSON.stringify(items) + "\n```" }] });
    }
    if (p === "/__last-gemini-key") return send(res, 200, { key: globalThis.lastGeminiKey || null });
    // fake Gemini generateContent (same fake rewrite as above)
    if (/^\/v1beta\/models\/[^/]+:generateContent$/.test(p) && req.method === "POST") {
      const gkey = String(req.headers["x-goog-api-key"] || "");
      globalThis.lastGeminiKey = gkey.slice(0, 8);
      if (/BADKEY/.test(gkey)) return send(res, 400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid." } });
      if (process.env.MOCK_GEMINI_BUSY && p.includes(process.env.MOCK_GEMINI_BUSY)) return send(res, 503, { error: { code: 503, status: "UNAVAILABLE", message: "high demand" } });
      const b = JSON.parse((await body(req)).toString() || "{}");
      const user = b.contents?.[0]?.parts?.[0]?.text || "";
      if (/research librarian/.test(b.systemInstruction?.parts?.[0]?.text || "")) {
        // fake deck organiser: pathology-ish titles to the existing pathology deck (or a new one), the rest by theme
        const q = JSON.parse(user);
        const path = q.existingDecks.find((d) => /patholog/i.test(d.name));
        const isPath = (p) => /patholog|slide|histolog|microsatellite|carcinoma/i.test(p.title);
        const decks = [
          { name: "Computational pathology", existingRef: path?.ref ?? null, why: "Deep learning on histology slides.", paperRefs: q.papers.filter(isPath).map((p) => p.ref) },
          { name: "Foundations of deep learning", existingRef: null, why: "Core architectures the field builds on.", paperRefs: q.papers.filter((p) => /attention|residual|protein/i.test(p.title)).map((p) => p.ref) },
          { name: "Genome editing", existingRef: null, why: "CRISPR biology.", paperRefs: q.papers.filter((p) => /DNA|CRISPR/i.test(p.title)).map((p) => p.ref) },
        ];
        return send(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ decks }) }] } }] });
      }
      const passages = JSON.parse(user.slice(user.indexOf("[")));
      const clean = /Keep the author's wording/.test(b.systemInstruction?.parts?.[0]?.text || "");
      const ask = user.match(/Instruction: (".*?")\n/);
      const items = passages.map((x) => ({ id: x.id, text: ask ? `Answer to ${JSON.parse(ask[1])}: the passage says weak labels replace manual outlining.` : clean ? x.text : x.text.split(/\s+/).slice(0, 9).join(" ").replace(/[,.;:]$/, "") + " (Gemini note)." }));
      return send(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }] });
    }
    // ---- fake ORCID public API and OpenAlex (set PAPERCARDS_ORCID_BASE / PAPERCARDS_OPENALEX_BASE to this server)
    const orcidM = p.match(/^\/v3\.0\/([\dX-]{19})\/(works|person)$/);
    if (orcidM) {
      if (orcidM[2] === "person") return send(res, 200, { name: { "given-names": { value: "Ada" }, "family-name": { value: "Researcher" } } });
      const w = (title, year, doi, journal) => ({ "work-summary": [{ title: { title: { value: title } }, "publication-date": { year: { value: String(year) } }, "journal-title": { value: journal }, type: "journal-article", "external-ids": doi ? { "external-id": [{ "external-id-type": "doi", "external-id-value": doi }] } : null }] });
      return send(res, 200, { group: [
        w("Foundation models for oral cancer histology", 2026, "10.5555/oscc.2026.1", "Journal of Pathology Informatics"),
        w("Sleep disorder treatments in epilepsy: a network meta-analysis", 2025, "10.5555/sleep.2025.7", "Epilepsia"),
        w("Highly accurate protein structure prediction with AlphaFold", 2021, "10.1038/s41586-021-03819-2", "Nature"),
        w("A poster without a DOI", 2024, null, "AAN Annual Meeting"),
      ] });
    }
    if (p === "/works" && url.searchParams.get("filter")?.startsWith("doi:")) {
      return send(res, 200, { results: [{ doi: "https://doi.org/10.5555/oscc.2026.1", display_name: "Foundation models for oral cancer histology", publication_year: 2026, authorships: [{ author: { display_name: "Ada Researcher" } }, { author: { display_name: "Amrit Pal Singh" } }], biblio: { volume: "17", first_page: "100", last_page: "112" } }], meta: {} });
    }
    if (p === "/works" && url.searchParams.get("filter")?.startsWith("author.id:")) {
      return send(res, 200, { results: [{ doi: null, display_name: "OpenAlex-only paper", publication_year: 2023, authorships: [{ author: { display_name: "Ada Researcher" } }], primary_location: { source: { display_name: "PLOS ONE" } } }], meta: { next_cursor: null } });
    }
    if (p === "/authors") {
      return send(res, 200, { results: [{ id: "https://openalex.org/A123", display_name: "Ada Researcher", works_count: 1, orcid: null, last_known_institutions: [{ display_name: "Example Institute" }] }] });
    }
    // ---- auth
    if (p === "/auth/v1/.well-known/jwks.json") return send(res, 200, { keys: [] });
    if (p === "/auth/v1/otp") return send(res, 200, {});
    if (p === "/auth/v1/settings") return send(res, 200, { external: { email: true, google: process.env.MOCK_GOOGLE === "1", anonymous_users: true } });
    if (p === "/auth/v1/signup" && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      if (b.email) {
        // Email + password sign-up with "Confirm email" on: no session until the 6-digit code (always 123456 here).
        const found = [...users.entries()].find(([, u]) => u.email === b.email);
        if (found) return send(res, 200, { ...userJson(found[0]), identities: [] });
        const nid = randomUUID();
        users.set(nid, { email: b.email, password: b.password, confirmed: false });
        db.profiles.push({ id: nid, display_name: b.email.split("@")[0], created_at: now(), updated_at: now() });
        if (process.env.MOCK_AUTOCONFIRM === "1") {
          users.get(nid).confirmed = true;
          return send(res, 200, sessionFor(nid));
        }
        return send(res, 200, { ...userJson(nid), identities: [{ provider: "email" }] });
      }
      const nid = randomUUID();
      users.set(nid, { email: undefined, anon: true });
      return send(res, 200, sessionFor(nid));
    }
    if (p === "/auth/v1/logout") return send(res, 204);
    if (p === "/auth/v1/user" && req.method === "GET") {
      const uid = uidFrom(req);
      return uid && users.has(uid) ? send(res, 200, userJson(uid)) : send(res, 401, { code: 401, msg: "invalid JWT" });
    }
    if (p === "/auth/v1/verify" && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const found = [...users.entries()].find(([, u]) => u.email === b.email);
      if (!found || b.token !== "123456") return send(res, 403, { code: "otp_expired", msg: "Token has expired or is invalid" });
      found[1].confirmed = true;
      return send(res, 200, sessionFor(found[0]));
    }
    if (p === "/auth/v1/resend" || p === "/auth/v1/recover") return send(res, 200, {});
    if (p === "/auth/v1/user" && req.method === "PUT") {
      const uid = uidFrom(req);
      if (!uid || !users.has(uid)) return send(res, 401, { msg: "invalid JWT" });
      const b = JSON.parse((await body(req)).toString() || "{}");
      if (b.password) users.get(uid).password = b.password;
      if (b.email) {
        if ([...users.values()].some((x) => x.email === b.email)) return send(res, 422, { code: "email_exists", msg: "A user with this email address has already been registered" });
        users.get(uid).email = b.email;
        users.get(uid).anon = false;
      }
      return send(res, 200, userJson(uid));
    }
    if (p === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const found = [...users.entries()].find(([, u]) => u.email === b.email && u.password && u.password === b.password);
      if (!found) return send(res, 400, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (found[1].confirmed === false) return send(res, 400, { code: "email_not_confirmed", error_code: "email_not_confirmed", msg: "Email not confirmed" });
      return send(res, 200, sessionFor(found[0]));
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

    // ---- feedback: anyone may insert; only admins (demo user here) may read, triage or delete
    if (p === "/rest/v1/feedback") {
      const admin = uid && users.get(uid)?.email === "demo@papercards.test";
      if (req.method === "POST") {
        const r = JSON.parse((await body(req)).toString() || "{}");
        if (((r.message || "").length < 3 && !Object.keys(r.answers || {}).length) || r.status || r.admin_note) return send(res, 403, { code: "42501", message: "new row violates row-level security policy" });
        feedback.unshift({ id: randomUUID(), created_at: now(), updated_at: now(), status: "new", admin_note: null, user_id: uid ?? null, rating: null, answers: {}, name: null, email: null, role: null, page: null, user_agent: null, ...r });
        return send(res, 201, "");
      }
      if (!admin) return req.method === "GET" ? send(res, 200, [], { "Content-Range": "*/0" }) : send(res, 204);
      const idEq = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      if (req.method === "PATCH") {
        const patch = JSON.parse((await body(req)).toString() || "{}");
        const row = feedback.find((f) => f.id === idEq);
        if (row) Object.assign(row, patch, { updated_at: now() });
        return /return=representation/.test(req.headers.prefer || "") ? send(res, 200, row ? [row] : []) : send(res, 204);
      }
      if (req.method === "DELETE") {
        const i = feedback.findIndex((f) => f.id === idEq);
        if (i >= 0) feedback.splice(i, 1);
        return send(res, 204);
      }
      return send(res, 200, feedback, { "Content-Range": `0-${Math.max(feedback.length - 1, 0)}/${feedback.length}` });
    }
    if (p === "/rest/v1/rpc/is_feedback_admin") return send(res, 200, Boolean(uid && users.get(uid)?.email === "demo@papercards.test"));

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
          const existing = /merge-duplicates/.test(prefer) && r.id && db[table].find((x) => x.id === r.id);
          if (existing) {
            Object.assign(existing, r, { updated_at: now() });
            rows.push(existing);
            continue;
          }
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

// Extra demo library for marketing screenshots: MOCK_RICH=1. Real, well-known papers (bibliographic facts only).
function seedRich() {
  const u = DEMO_UID;
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const byName = (n) => db.collections.find((c) => c.name === n);
  const col = (name) => byName(name) ?? insertRow("collections", { name, summary: "" }, u);
  const tagBy = (n) => db.tags.find((t) => t.name === n) ?? insertRow("tags", { name: n }, u);
  const D = {
    path: col("Computational pathology"), fm: col("Foundation models"), jc: col("Journal club, October"),
    epi: col("Sleep in epilepsy"), heme: col("Hematologic malignancy genomics"), sc: col("Single-cell and spatial"), img: col("Medical imaging AI"),
  };
  const A = (...names) => names.map((n) => { const [given, family] = n.includes(" ") ? [n.split(" ").slice(0, -1).join(" "), n.split(" ").slice(-1)[0]] : ["", n]; return { family, given }; });
  const R = [
    ["Towards a general-purpose foundation model for computational pathology", A("Richard J. Chen", "Faisal Mahmood"), 2024, "Nature Medicine", ["path", "fm"], ["WSI", "transformers"], "annotated"],
    ["A visual-language foundation model for computational pathology", A("Ming Y. Lu", "Faisal Mahmood"), 2024, "Nature Medicine", ["path", "fm"], ["WSI"], "read"],
    ["A whole-slide foundation model for digital pathology from real-world data", A("Hanwen Xu", "Hoifung Poon"), 2024, "Nature", ["path", "fm"], ["WSI", "transformers"], "reading"],
    ["Virchow: a million-slide digital pathology foundation model", A("Eugene Vorontsov", "Thomas J. Fuchs"), 2024, "Nature Medicine", ["path", "fm"], ["WSI"], "to_read"],
    ["Pan-cancer integrative histology-genomic analysis via multimodal deep learning", A("Richard J. Chen", "Faisal Mahmood"), 2022, "Cancer Cell", ["path", "heme"], ["WSI", "MIL"], "read"],
    ["Attention-based deep multiple instance learning", A("Maximilian Ilse", "Jakub Tomczak", "Max Welling"), 2018, "ICML", ["path"], ["MIL"], "annotated"],
    ["Interpretable survival prediction for colorectal cancer using deep learning", A("Ellery Wulczyn", "David F. Steiner"), 2021, "npj Digital Medicine", ["path", "img"], ["WSI"], "to_read"],
    ["Deep learning for oral cancer detection from histopathology images", A("Santisudha Panigrahi", "Tripti Swarnkar"), 2020, "Oral Oncology", ["path"], ["OSCC"], "to_read"],
    ["An image is worth 16x16 words: transformers for image recognition at scale", A("Alexey Dosovitskiy", "Neil Houlsby"), 2021, "ICLR", ["fm", "img"], ["transformers"], "read"],
    ["Language models are few-shot learners", A("Tom Brown", "Dario Amodei"), 2020, "NeurIPS", ["fm"], ["transformers"], "read"],
    ["Emerging properties in self-supervised vision transformers", A("Mathilde Caron", "Armand Joulin"), 2021, "ICCV", ["fm", "img"], ["transformers"], "annotated"],
    ["Learning transferable visual models from natural language supervision", A("Alec Radford", "Ilya Sutskever"), 2021, "ICML", ["fm"], ["transformers"], "reading"],
    ["Large language models encode clinical knowledge", A("Karan Singhal", "Vivek Natarajan"), 2023, "Nature", ["fm", "jc"], ["transformers"], "read"],
    ["Segment anything", A("Alexander Kirillov", "Ross Girshick"), 2023, "ICCV", ["fm", "img"], [], "to_read"],
    ["Dermatologist-level classification of skin cancer with deep neural networks", A("Andre Esteva", "Sebastian Thrun"), 2017, "Nature", ["img", "jc"], [], "read"],
    ["International evaluation of an AI system for breast cancer screening", A("Scott Mayer McKinney", "Shravya Shetty"), 2020, "Nature", ["img"], [], "annotated"],
    ["CheXNet: radiologist-level pneumonia detection on chest X-rays", A("Pranav Rajpurkar", "Andrew Y. Ng"), 2017, "arXiv", ["img"], [], "read"],
    ["U-Net: convolutional networks for biomedical image segmentation", A("Olaf Ronneberger", "Thomas Brox"), 2015, "MICCAI", ["img", "path"], [], "read"],
    ["Sleep and epilepsy: a bidirectional relationship", A("Milena Pavlova", "Sanjeev V. Kothare"), 2021, "Neurologic Clinics", ["epi"], ["sleep"], "annotated"],
    ["Obstructive sleep apnea in adults with epilepsy", A("Beth A. Malow", "Ronald D. Chervin"), 2000, "Neurology", ["epi"], ["sleep"], "read"],
    ["Melatonin for epilepsy: a systematic review", A("Ivana Brigo", "Raffaele Nardone"), 2016, "Cochrane Database of Systematic Reviews", ["epi"], ["sleep", "meta-analysis"], "reading"],
    ["CPAP therapy and seizure control in epilepsy with sleep apnea", A("Anne Vendrame", "Sandra Auerbach"), 2014, "Epilepsy & Behavior", ["epi"], ["sleep"], "to_read"],
    ["Network meta-analysis: a primer for clinicians", A("Georgia Salanti"), 2012, "Research Synthesis Methods", ["epi", "jc"], ["meta-analysis"], "read"],
    ["The PRISMA 2020 statement: an updated guideline for reporting systematic reviews", A("Matthew J. Page", "David Moher"), 2021, "BMJ", ["epi"], ["meta-analysis"], "read"],
    ["Seizure detection from EEG using deep learning", A("Ian Covert", "Jenna Wiens"), 2019, "Machine Learning for Healthcare", ["epi", "img"], ["EEG"], "to_read"],
    ["Genomic classification and prognosis in acute myeloid leukemia", A("Elli Papaemmanuil", "Peter J. Campbell"), 2016, "New England Journal of Medicine", ["heme"], ["AML"], "annotated"],
    ["Clonal hematopoiesis and blood-cancer risk inferred from blood DNA sequence", A("Giulio Genovese", "Steven A. McCarroll"), 2014, "New England Journal of Medicine", ["heme"], ["CHIP"], "read"],
    ["Age-related clonal hematopoiesis associated with adverse outcomes", A("Siddhartha Jaiswal", "Benjamin L. Ebert"), 2014, "New England Journal of Medicine", ["heme", "jc"], ["CHIP"], "read"],
    ["The 5th edition of the WHO classification of haematolymphoid tumours", A("Joseph D. Khoury", "Ayalew Tefferi"), 2022, "Leukemia", ["heme"], ["AML"], "reading"],
    ["Single-cell RNA-seq reveals AML hierarchies relevant to disease progression", A("Peter van Galen", "Bradley E. Bernstein"), 2019, "Cell", ["heme", "sc"], ["AML", "single-cell"], "to_read"],
    ["Comprehensive integration of single-cell data", A("Tim Stuart", "Rahul Satija"), 2019, "Cell", ["sc"], ["single-cell"], "read"],
    ["Spatially resolved transcriptomics in the tumour microenvironment", A("Ludvig Larsson", "Joakim Lundeberg"), 2021, "Nature Reviews Cancer", ["sc", "path"], ["single-cell"], "to_read"],
    ["Mapping the human cell atlas", A("Aviv Regev", "Sarah Teichmann"), 2017, "eLife", ["sc"], ["single-cell"], "read"],
    ["Predicting gene expression from histology with deep learning", A("Bryan He", "James Zou"), 2020, "Nature Biomedical Engineering", ["sc", "path"], ["WSI", "single-cell"], "annotated"],
  ];
  const st = { annotated: 3, read: 2, reading: 1, to_read: 0 };
  R.forEach(([title, authors, year, journal, decks, tags, status], i) => {
    const paper = insertRow("papers", { title, authors, year, journal, status, priority: (i * 7) % 4, study_type: /review|primer|statement|classification of haemato/i.test(title) ? "review" : "original" }, u);
    paper.created_at = daysAgo(i * 0.7 + 2);
    paper.updated_at = daysAgo(i * 0.5 + 1);
    decks.forEach((d) => insertRow("collection_papers", { collection_id: D[d].id, paper_id: paper.id }, u));
    tags.forEach((t) => insertRow("paper_tags", { paper_id: paper.id, tag_id: tagBy(t).id }, u));
    const secs = db.note_sections.filter((s) => s.paper_id === paper.id);
    secs.slice(0, st[status] + (status === "annotated" ? 1 : 0)).forEach((sec) => (sec.content_html = "<ul><li>Key finding noted.</li></ul>"));
  });
}
if (process.env.MOCK_EMPTY !== "1") seed();
if (process.env.MOCK_RICH === "1") seedRich();

server.listen(PORT, () => console.log(`mock supabase on http://localhost:${PORT} (demo user ${DEMO_UID})`));
