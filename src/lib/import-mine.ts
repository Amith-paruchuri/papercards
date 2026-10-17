"use client";
// Adds works found on ORCID / OpenAlex / a BibTeX export to the library as "My publications".
// Papers already in the library (same DOI or same title) are marked as yours instead of duplicated;
// ones sitting in Trash are restored.
import { createPaper, importIndex, restorePapers, setMine, titleKey } from "./data";
import type { Work } from "./publications";

export type MatchState = "new" | "in-library" | "mine";

export async function classifyWorks(works: Work[]): Promise<MatchState[]> {
  const { byDoi, byTitle } = await importIndex();
  return works.map((w) => {
    const hit = (w.doi && byDoi.get(w.doi)) || byTitle.get(titleKey(w.title));
    if (!hit) return "new";
    return hit.mine && !hit.trashed ? "mine" : "in-library";
  });
}

export async function importWorks(works: Work[], onProgress?: (done: number, total: number) => void): Promise<{ added: number; marked: number; failed: number }> {
  const { byDoi, byTitle } = await importIndex();
  let added = 0,
    marked = 0,
    failed = 0,
    done = 0;
  const queue = [...works];
  async function worker() {
    for (let w = queue.shift(); w; w = queue.shift()) {
      try {
        const hit = (w.doi && byDoi.get(w.doi)) || byTitle.get(titleKey(w.title));
        if (hit) {
          if (hit.trashed) await restorePapers([hit.id]);
          if (!hit.mine) await setMine([hit.id], true);
          marked++;
        } else {
          await createPaper({
            title: w.title,
            authors: w.authors,
            year: w.year,
            journal: w.journal,
            volume: w.volume,
            issue: w.issue,
            pages: w.pages,
            doi: w.doi,
            url: w.url,
            item_type: w.item_type,
            status: "read",
            is_mine: true,
          });
          added++;
        }
      } catch {
        failed++;
      } finally {
        onProgress?.(++done, works.length);
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { added, marked, failed };
}
