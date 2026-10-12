"use client";
// Lazy-load pdf.js in the browser only. The worker is served from /public (copied by scripts/copy-pdf-worker.mjs).
type PdfJs = typeof import("pdfjs-dist");

let loading: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  if (!loading) {
    loading = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return loading;
}

export async function openPdf(data: ArrayBuffer | Uint8Array) {
  const pdfjs = await loadPdfJs();
  // pdf.js transfers the buffer to the worker; pass a copy so callers can reuse theirs.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
