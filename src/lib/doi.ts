// DOI helpers. Pure functions, no imports, so they run in the browser, on the server and in tests.

const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s"'<>]+)/i;

/** Normalise user input ("https://doi.org/10.x/Y", "doi:10.x/Y", " 10.x/Y. ") to a lowercase bare DOI, or null. */
export function normalizeDoi(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep as is
  }
  s = s.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  const m = s.match(DOI_PATTERN);
  if (!m) return null;
  return cleanDoi(m[1]);
}

/** Find the first DOI in a block of text (e.g. extracted from a PDF's first pages). */
export function findDoiInText(text: string | null | undefined): string | null {
  if (!text) return null;
  // PDF text often splits "doi: 10.1038/ s41586" across items; join a stray space after the slash.
  const compact = text.replace(/(10\.\d{4,9}\/)\s+/g, "$1");
  const m = compact.match(DOI_PATTERN);
  return m ? cleanDoi(m[1]) : null;
}

function cleanDoi(raw: string): string | null {
  let doi = raw.trim();
  // Strip trailing punctuation that is almost never part of a DOI.
  doi = doi.replace(/[.,;:)\]}>]+$/, "");
  // Drop an unbalanced trailing ")" left over from "(doi: ...)".
  if (doi.endsWith(")") && (doi.match(/\(/g) || []).length < (doi.match(/\)/g) || []).length) {
    doi = doi.slice(0, -1);
  }
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi.toLowerCase() : null;
}

export function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}
