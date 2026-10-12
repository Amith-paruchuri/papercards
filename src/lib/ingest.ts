"use client";
// Turn a PDF file or a DOI into a card: extract -> look up metadata -> create -> upload.
import { normalizeDoi } from "./doi";
import { extractPdfGuess } from "./pdf/extract";
import { sha256Hex } from "./pdf/pdfjs";
import { addPapersToCollection, createPaper, DuplicateDoiError, findPaperByPdfHash, getPaper, uploadPdf } from "./data";
import { emptyMeta, type Paper, type PaperMeta } from "./types";

export async function lookupDoi(doi: string): Promise<PaperMeta> {
  const res = await fetch(`/api/metadata/doi?doi=${encodeURIComponent(doi)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lookup failed (${res.status})`);
  return body.meta as PaperMeta;
}

export type IngestResult =
  | { kind: "created"; paper: Paper; note?: string }
  | { kind: "attached"; paper: Paper }
  | { kind: "duplicate"; paperId: string; note: string };

export async function ingestPdf(file: File, collectionId: string | null): Promise<IngestResult> {
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Not a PDF.");
  }
  const buf = await file.arrayBuffer();
  const sha = await sha256Hex(buf);
  const dupe = await findPaperByPdfHash(sha);
  if (dupe) return { kind: "duplicate", paperId: dupe, note: "This exact PDF is already in your library." };

  const guess = await extractPdfGuess(buf);
  let meta: PaperMeta = {
    ...emptyMeta(),
    title: guess.title || file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "),
    authors: guess.authors,
    year: guess.year,
    doi: guess.doi,
  };
  let note: string | undefined;
  if (guess.doi) {
    try {
      meta = await lookupDoi(guess.doi);
    } catch {
      note = "Found a DOI but couldn't fetch its metadata; check the details.";
    }
  } else {
    note = "No DOI found in the PDF; title and authors were guessed from the first page.";
  }

  let paper: Paper;
  try {
    paper = await createPaper({ ...meta, status: "to_read" });
  } catch (e) {
    if (e instanceof DuplicateDoiError && e.existingId) {
      const existing = await getPaper(e.existingId);
      if (existing && !existing.pdf_path) {
        const updated = await uploadPdf(existing.id, file, sha);
        if (collectionId) await addPapersToCollection([existing.id], collectionId);
        return { kind: "attached", paper: updated };
      }
      return { kind: "duplicate", paperId: e.existingId, note: "A card with this DOI already exists." };
    }
    throw e;
  }
  const withPdf = await uploadPdf(paper.id, file, sha);
  if (collectionId) await addPapersToCollection([paper.id], collectionId);
  return { kind: "created", paper: withPdf, note };
}

export async function ingestDoi(input: string, collectionId: string | null): Promise<IngestResult> {
  const doi = normalizeDoi(input);
  if (!doi) throw new Error(`"${input}" is not a DOI.`);
  const meta = await lookupDoi(doi);
  try {
    const paper = await createPaper({ ...meta, status: "to_read" });
    if (collectionId) await addPapersToCollection([paper.id], collectionId);
    return { kind: "created", paper };
  } catch (e) {
    if (e instanceof DuplicateDoiError) {
      if (e.existingId && collectionId) await addPapersToCollection([e.existingId], collectionId);
      return { kind: "duplicate", paperId: e.existingId ?? "", note: "Already in your library." };
    }
    throw e;
  }
}
