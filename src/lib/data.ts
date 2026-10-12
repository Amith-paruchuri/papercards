"use client";
// Single data-access module. UI never talks to Supabase directly; RLS enforces ownership server-side.
import { supabaseBrowser } from "./supabase/client";
import type {
  Collection,
  Highlight,
  HighlightRect,
  LibraryPaper,
  NoteSection,
  Paper,
  PaperMeta,
  PaperStatus,
  StudyType,
  Tag,
} from "./types";

const PAPER_COLUMNS =
  "id, owner_id, title, authors, year, journal, volume, issue, pages, publisher, doi, url, abstract, item_type, study_type, site, subjects, status, priority, pdf_path, pdf_sha256, pdf_size, legacy_id, created_at, updated_at";

export const PDF_BUCKET = "pdfs";
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

const db = () => supabaseBrowser();

function fail(error: { message: string; code?: string } | null, context: string): void {
  if (error) {
    const e = new Error(`${context}: ${error.message}`) as Error & { code?: string };
    e.code = error.code;
    throw e;
  }
}

export class DuplicateDoiError extends Error {
  constructor(public existingId: string | null) {
    super("This DOI is already in your library.");
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export async function currentUser() {
  const { data } = await db().auth.getSession();
  return data.session?.user ?? null;
}

export async function signOut() {
  await db().auth.signOut();
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------
export async function listLibrary(): Promise<LibraryPaper[]> {
  const { data, error } = await db()
    .from("papers")
    .select(`${PAPER_COLUMNS}, paper_tags(tag_id), collection_papers(collection_id)`)
    .order("updated_at", { ascending: false });
  fail(error, "Loading library");
  return (data ?? []) as unknown as LibraryPaper[];
}

/** Build a prefix-matching tsquery: "oral carc" -> "oral:* & carc:*". */
export function toPrefixQuery(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 8);
  return tokens.length ? tokens.map((t) => `${t}:*`).join(" & ") : null;
}

export async function searchPaperIds(q: string): Promise<Set<string>> {
  const query = toPrefixQuery(q);
  if (!query) return new Set();
  const { data, error } = await db().from("papers").select("id").textSearch("search", query, { config: "english" });
  fail(error, "Search");
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

export async function getPaper(id: string): Promise<Paper | null> {
  const { data, error } = await db().from("papers").select(PAPER_COLUMNS).eq("id", id).maybeSingle();
  fail(error, "Loading paper");
  return data as Paper | null;
}

export async function findPaperByDoi(doi: string): Promise<string | null> {
  const { data } = await db().from("papers").select("id").eq("doi", doi.toLowerCase()).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export type NewPaper = Partial<PaperMeta> & {
  title: string;
  status?: PaperStatus;
  study_type?: StudyType | null;
  site?: string | null;
  subjects?: string[];
  priority?: number;
  legacy_id?: string | null;
};

export async function createPaper(input: NewPaper): Promise<Paper> {
  const row = { ...input, doi: input.doi ? input.doi.toLowerCase() : null, title: input.title.trim() || "Untitled" };
  const { data, error } = await db().from("papers").insert(row).select(PAPER_COLUMNS).single();
  if (error?.code === "23505" && row.doi) throw new DuplicateDoiError(await findPaperByDoi(row.doi));
  fail(error, "Creating paper");
  return data as Paper;
}

export async function updatePaper(id: string, patch: Partial<Omit<Paper, "id" | "owner_id" | "created_at" | "updated_at">>) {
  const clean = { ...patch } as Record<string, unknown>;
  if (typeof clean.doi === "string") clean.doi = (clean.doi as string).toLowerCase() || null;
  const { data, error } = await db().from("papers").update(clean).eq("id", id).select(PAPER_COLUMNS).single();
  if (error?.code === "23505") throw new DuplicateDoiError(typeof clean.doi === "string" ? await findPaperByDoi(clean.doi) : null);
  fail(error, "Saving paper");
  return data as Paper;
}

export async function deletePaper(paper: Pick<Paper, "id" | "pdf_path">) {
  if (paper.pdf_path) await db().storage.from(PDF_BUCKET).remove([paper.pdf_path]);
  const { error } = await db().from("papers").delete().eq("id", paper.id);
  fail(error, "Deleting paper");
}

export async function setStatus(ids: string[], status: PaperStatus) {
  const { error } = await db().from("papers").update({ status }).in("id", ids);
  fail(error, "Updating status");
}

// ---------------------------------------------------------------------------
// PDFs (private bucket, path = {owner_id}/{paper_id}.pdf)
// ---------------------------------------------------------------------------
export async function uploadPdf(paperId: string, file: Blob, sha256: string | null): Promise<Paper> {
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF is larger than 50 MB.");
  const user = await currentUser();
  if (!user) throw new Error("Not signed in.");
  const path = `${user.id}/${paperId}.pdf`;
  const { error } = await db().storage.from(PDF_BUCKET).upload(path, file, { upsert: true, contentType: "application/pdf" });
  fail(error, "Uploading PDF");
  return updatePaper(paperId, { pdf_path: path, pdf_sha256: sha256, pdf_size: file.size });
}

export async function downloadPdf(path: string): Promise<ArrayBuffer> {
  const { data, error } = await db().storage.from(PDF_BUCKET).download(path);
  fail(error, "Loading PDF");
  return await (data as Blob).arrayBuffer();
}

export async function pdfSignedUrl(path: string, seconds = 3600): Promise<string> {
  const { data, error } = await db().storage.from(PDF_BUCKET).createSignedUrl(path, seconds);
  fail(error, "Opening PDF");
  return data!.signedUrl;
}

export async function removePdf(paper: Pick<Paper, "id" | "pdf_path">) {
  if (paper.pdf_path) {
    const { error } = await db().storage.from(PDF_BUCKET).remove([paper.pdf_path]);
    fail(error, "Removing PDF");
  }
  return updatePaper(paper.id, { pdf_path: null, pdf_sha256: null, pdf_size: null });
}

export async function findPaperByPdfHash(sha256: string): Promise<string | null> {
  const { data } = await db().from("papers").select("id").eq("pdf_sha256", sha256).limit(1);
  return (data as { id: string }[] | null)?.[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Collections (decks)
// ---------------------------------------------------------------------------
export async function listCollections(): Promise<Collection[]> {
  const { data, error } = await db().from("collections").select("*").order("position").order("name");
  fail(error, "Loading collections");
  return (data ?? []) as Collection[];
}

export async function createCollection(name: string, parentId: string | null = null): Promise<Collection> {
  const { data, error } = await db().from("collections").insert({ name: name.trim(), parent_id: parentId }).select("*").single();
  fail(error, "Creating collection");
  return data as Collection;
}

export async function updateCollection(id: string, patch: Partial<Pick<Collection, "name" | "summary" | "parent_id" | "position">>) {
  const { data, error } = await db().from("collections").update(patch).eq("id", id).select("*").single();
  fail(error, "Saving collection");
  return data as Collection;
}

export async function deleteCollection(id: string) {
  const { error } = await db().from("collections").delete().eq("id", id);
  fail(error, "Deleting collection");
}

export async function addPapersToCollection(paperIds: string[], collectionId: string) {
  if (!paperIds.length) return;
  const rows = paperIds.map((paper_id) => ({ paper_id, collection_id: collectionId }));
  const { error } = await db().from("collection_papers").upsert(rows, { onConflict: "collection_id,paper_id", ignoreDuplicates: true });
  fail(error, "Adding to collection");
}

export async function removePaperFromCollection(paperId: string, collectionId: string) {
  const { error } = await db().from("collection_papers").delete().eq("paper_id", paperId).eq("collection_id", collectionId);
  fail(error, "Removing from collection");
}

// ---------------------------------------------------------------------------
// Tags (labels)
// ---------------------------------------------------------------------------
export async function listTags(): Promise<Tag[]> {
  const { data, error } = await db().from("tags").select("*").order("name");
  fail(error, "Loading tags");
  return (data ?? []) as Tag[];
}

export async function ensureTag(name: string, existing: Tag[]): Promise<Tag> {
  const clean = name.trim().replace(/\s+/g, " ");
  const found = existing.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (found) return found;
  const { data, error } = await db().from("tags").insert({ name: clean }).select("*").single();
  if (error?.code === "23505") {
    const { data: again } = await db().from("tags").select("*").ilike("name", clean).maybeSingle();
    if (again) return again as Tag;
  }
  fail(error, "Creating tag");
  return data as Tag;
}

export async function addTagToPapers(paperIds: string[], tagId: string) {
  if (!paperIds.length) return;
  const rows = paperIds.map((paper_id) => ({ paper_id, tag_id: tagId }));
  const { error } = await db().from("paper_tags").upsert(rows, { onConflict: "paper_id,tag_id", ignoreDuplicates: true });
  fail(error, "Tagging");
}

export async function removeTagFromPaper(paperId: string, tagId: string) {
  const { error } = await db().from("paper_tags").delete().eq("paper_id", paperId).eq("tag_id", tagId);
  fail(error, "Removing tag");
}

export async function renameTag(id: string, name: string) {
  const { error } = await db().from("tags").update({ name: name.trim() }).eq("id", id);
  fail(error, "Renaming tag");
}

export async function deleteTag(id: string) {
  const { error } = await db().from("tags").delete().eq("id", id);
  fail(error, "Deleting tag");
}

// ---------------------------------------------------------------------------
// Note sections
// ---------------------------------------------------------------------------
export async function listSections(paperId: string): Promise<NoteSection[]> {
  const { data, error } = await db().from("note_sections").select("*").eq("paper_id", paperId).order("position");
  fail(error, "Loading notes");
  return (data ?? []) as NoteSection[];
}

export async function listAllSections(paperIds: string[]): Promise<NoteSection[]> {
  if (!paperIds.length) return [];
  const { data, error } = await db().from("note_sections").select("*").in("paper_id", paperIds).order("position");
  fail(error, "Loading notes");
  return (data ?? []) as NoteSection[];
}

export async function createSection(paperId: string, title: string, position: number, color: string | null = null) {
  const { data, error } = await db().from("note_sections").insert({ paper_id: paperId, title, position, color }).select("*").single();
  fail(error, "Adding section");
  return data as NoteSection;
}

export async function updateSection(id: string, patch: Partial<Pick<NoteSection, "title" | "content_html" | "color" | "position">>) {
  const { error } = await db().from("note_sections").update(patch).eq("id", id);
  fail(error, "Saving notes");
}

export async function deleteSection(id: string) {
  const { error } = await db().from("note_sections").delete().eq("id", id);
  fail(error, "Deleting section");
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------
export async function listHighlights(paperId: string): Promise<Highlight[]> {
  const { data, error } = await db().from("highlights").select("*").eq("paper_id", paperId).order("page").order("created_at");
  fail(error, "Loading highlights");
  return (data ?? []) as Highlight[];
}

export async function createHighlight(h: { paper_id: string; section_id: string | null; page: number; text: string; color: string | null; rects: HighlightRect[] }) {
  const { data, error } = await db().from("highlights").insert(h).select("*").single();
  fail(error, "Saving highlight");
  return data as Highlight;
}

export async function deleteHighlight(id: string) {
  const { error } = await db().from("highlights").delete().eq("id", id);
  fail(error, "Deleting highlight");
}
