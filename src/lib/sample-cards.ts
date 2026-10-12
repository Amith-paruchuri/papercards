// Real landmark papers shown as decorative cards (sign-in and first-run screens), one per reading state.
import type { LibraryPaper } from "./types";

type DemoCard = Pick<LibraryPaper, "id" | "title" | "authors" | "year" | "journal" | "abstract" | "status" | "priority" | "pdf_path" | "note_sections">;
const sec = (on: boolean[]) =>
  ["#5ec4ee", "#7ed67e", "#f0c463", "#f0879b"].map((color, i) => ({ id: String(i), color, position: i, has_notes: on[i] }));

export const SAMPLE_CARDS: DemoCard[] = [
  { id: "a", title: "Highly accurate protein structure prediction with AlphaFold", authors: [{ family: "Jumper" }, { family: "Evans" }, { family: "Pritzel" }], year: 2021, journal: "Nature", abstract: null, status: "reading", priority: 2, pdf_path: "x", note_sections: sec([true, false, false, false]) },
  { id: "b", title: "Clinical-grade computational pathology using weakly supervised deep learning on whole slide images", authors: [{ family: "Campanella" }, { family: "Hanna" }, { family: "Fuchs" }], year: 2019, journal: "Nature Medicine", abstract: null, status: "annotated", priority: 3, pdf_path: "x", note_sections: sec([true, true, true, false]) },
  { id: "c", title: "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity", authors: [{ family: "Jinek" }, { family: "Chylinski" }, { family: "Fonfara" }], year: 2012, journal: "Science", abstract: null, status: "to_read", priority: 1, pdf_path: null, note_sections: sec([false, false, false, false]) },
];
