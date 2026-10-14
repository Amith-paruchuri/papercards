// Cleans text copied out of a PDF so a highlight reads like a sentence, not a scan:
// rejoins words split across lines, expands ligatures, drops bracketed reference numbers,
// and tidies spacing. Pure function (no DOM), so it runs anywhere and is unit-tested.

const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

export function cleanPdfText(raw: string): string {
  let t = raw ?? "";
  t = t.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c);
  t = t.replace(/­/g, ""); // soft hyphens
  t = t.replace(/[   ]/g, " ");
  // "trans-\nformation" or "trans- formation" -> "transformation" (only lower-case continuations,
  // so real compounds like "COVID-19" or "T- and B-cells" survive)
  t = t.replace(/([A-Za-z]{2,})-\s*\n\s*([a-z])/g, "$1$2");
  t = t.replace(/([a-z]{2,})- ([a-z]{2,})/g, "$1$2");
  t = t.replace(/\s*\n\s*/g, " ");
  // numeric citation markers: [12], [3, 4], [5–7]
  t = t.replace(/\s?\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, "");
  t = t.replace(/\s+([,.;:!?)])/g, "$1");
  t = t.replace(/([(])\s+/g, "$1");
  t = t.replace(/\s{2,}/g, " ").trim();
  // start with a capital letter when the selection began mid-sentence
  if (/^[a-z]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
  return t;
}
