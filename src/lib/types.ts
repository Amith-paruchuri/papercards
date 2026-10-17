export type PaperStatus = "to_read" | "reading" | "read" | "annotated";
export type StudyType =
  | "original"
  | "review"
  | "systematic_review"
  | "meta_analysis"
  | "case_report"
  | "preprint"
  | "other";

export interface Author {
  family: string;
  given?: string;
}

/** Bibliographic fields shared by metadata lookups, forms and exports. */
export interface PaperMeta {
  title: string;
  authors: Author[];
  year: number | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  item_type: string;
}

export interface Paper extends PaperMeta {
  id: string;
  owner_id: string;
  study_type: StudyType | null;
  site: string | null;
  subjects: string[];
  status: PaperStatus;
  priority: number;
  pdf_path: string | null;
  pdf_sha256: string | null;
  pdf_size: number | null;
  legacy_id: string | null;
  /** The user is an author of this paper (shown under My publications). */
  is_mine: boolean;
  /** Set when moved to Trash; purged for good after TRASH_DAYS. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export const TRASH_DAYS = 30;

export interface Profile {
  id: string;
  display_name: string | null;
  orcid: string | null;
  scholar_url: string | null;
  researchgate_url: string | null;
  openalex_id: string | null;
  publications_synced_at: string | null;
}

/** Paper row as loaded for the library, with membership ids embedded. */
export interface LibraryPaper extends Paper {
  paper_tags: { tag_id: string }[];
  collection_papers: { collection_id: string }[];
  note_sections?: { id: string; color: string | null; position: number; has_notes: boolean }[];
}

export interface Collection {
  id: string;
  owner_id: string;
  name: string;
  parent_id: string | null;
  summary: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  owner_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface NoteSection {
  id: string;
  owner_id: string;
  paper_id: string;
  title: string;
  color: string | null;
  position: number;
  content_html: string;
  created_at: string;
  updated_at: string;
}

export interface HighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Highlight {
  id: string;
  owner_id: string;
  paper_id: string;
  section_id: string | null;
  page: number;
  text: string;
  color: string | null;
  rects: HighlightRect[];
  created_at: string;
}

export const STATUS_LABELS: Record<PaperStatus, string> = {
  to_read: "To read",
  reading: "Reading",
  read: "Read",
  annotated: "Annotated",
};

export const STUDY_TYPE_LABELS: Record<StudyType, string> = {
  original: "Original study",
  review: "Review",
  systematic_review: "Systematic review",
  meta_analysis: "Meta-analysis",
  case_report: "Case report",
  preprint: "Preprint",
  other: "Other",
};

export function emptyMeta(): PaperMeta {
  return {
    title: "",
    authors: [],
    year: null,
    journal: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    doi: null,
    url: null,
    abstract: null,
    item_type: "article",
  };
}
