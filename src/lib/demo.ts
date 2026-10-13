// A ready-made demo library for "Try it now": real landmark papers (citation facts only, no abstracts),
// with short notes written for PaperCards. Built from bundled data, so it works even if Crossref is slow.
import {
  addPapersToCollection,
  addTagToPapers,
  createCollection,
  createPaper,
  ensureTag,
  listSections,
  listTags,
  updateSection,
  type NewPaper,
} from "./data";
import type { Tag } from "./types";

type DemoPaper = NewPaper & { notes?: Record<string, string[]>; tags?: string[]; collection?: string };

const DEMO: DemoPaper[] = [
  {
    title: "Highly accurate protein structure prediction with AlphaFold",
    authors: [{ family: "Jumper", given: "John" }, { family: "Evans", given: "Richard" }, { family: "Pritzel", given: "Alexander" }, { family: "Hassabis", given: "Demis" }],
    year: 2021, journal: "Nature", volume: "596", pages: "583-589", doi: "10.1038/s41586-021-03819-2",
    status: "reading", priority: 2, tags: ["protein structure"], collection: "Foundation models",
    notes: {
      Introduction: ["Structure prediction from sequence alone had been an open problem for about 50 years."],
      Methods: ["Attention over multiple sequence alignments and residue pairs, refined end to end."],
    },
  },
  {
    title: "Clinical-grade computational pathology using weakly supervised deep learning on whole slide images",
    authors: [{ family: "Campanella", given: "Gabriele" }, { family: "Hanna", given: "Matthew G." }, { family: "Fuchs", given: "Thomas J." }],
    year: 2019, journal: "Nature Medicine", volume: "25", pages: "1301-1309", doi: "10.1038/s41591-019-0508-1",
    status: "annotated", priority: 3, tags: ["WSI", "MIL"], collection: "Computational pathology",
    notes: {
      Introduction: ["Manual pixel-level annotation does not scale to clinical slide volumes."],
      Methods: ["Multiple instance learning with slide-level labels taken from pathology reports."],
      Results: ["Very high AUC for prostate cancer on held-out slides; could exclude most benign slides."],
    },
  },
  {
    title: "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity",
    authors: [{ family: "Jinek", given: "Martin" }, { family: "Chylinski", given: "Krzysztof" }, { family: "Doudna", given: "Jennifer A." }, { family: "Charpentier", given: "Emmanuelle" }],
    year: 2012, journal: "Science", volume: "337", pages: "816-821", doi: "10.1126/science.1225829",
    status: "to_read", priority: 3, tags: ["genome editing"],
  },
  {
    title: "Attention is all you need",
    authors: [{ family: "Vaswani", given: "Ashish" }, { family: "Shazeer", given: "Noam" }, { family: "Parmar", given: "Niki" }],
    year: 2017, journal: "Advances in Neural Information Processing Systems", url: "https://arxiv.org/abs/1706.03762",
    status: "read", priority: 1, tags: ["transformers"], collection: "Foundation models",
    notes: { Methods: ["Self-attention only, no recurrence; positional encodings carry order."] },
  },
  {
    title: "Deep residual learning for image recognition",
    authors: [{ family: "He", given: "Kaiming" }, { family: "Zhang", given: "Xiangyu" }, { family: "Ren", given: "Shaoqing" }, { family: "Sun", given: "Jian" }],
    year: 2016, journal: "IEEE Conference on Computer Vision and Pattern Recognition", pages: "770-778", doi: "10.1109/cvpr.2016.90",
    status: "to_read", priority: 1, collection: "Foundation models",
  },
];

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Creates the demo papers, notes, tags and collections. Returns how many papers were added. */
export async function seedDemoLibrary(): Promise<number> {
  let tags: Tag[] = await listTags();
  const collections = new Map<string, string>();
  let added = 0;
  // Oldest first, so the most interesting card ends up "recently edited".
  for (const d of [...DEMO].reverse()) {
    const { notes, tags: tagNames, collection, ...meta } = d;
    const paper = await createPaper(meta);
    added++;
    if (notes) {
      const sections = await listSections(paper.id);
      for (const s of sections) {
        const items = notes[s.title];
        if (items?.length) await updateSection(s.id, { content_html: `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` });
      }
    }
    for (const name of tagNames ?? []) {
      const t = await ensureTag(name, tags);
      if (!tags.some((x) => x.id === t.id)) tags = [...tags, t];
      await addTagToPapers([paper.id], t.id);
    }
    if (collection) {
      let id = collections.get(collection);
      if (!id) {
        id = (await createCollection(collection)).id;
        collections.set(collection, id);
      }
      await addPapersToCollection([paper.id], id);
    }
  }
  return added;
}
