// Shared shapes and checks for the feedback form (PaperCards and Choti Copy).
export const PRODUCTS = { papercards: "PaperCards", choticopy: "Choti Copy", both: "Both" } as const;
export const KINDS = { bug: "Something's broken", idea: "An idea", love: "Something I love", other: "Other" } as const;
export const STATUSES = { new: "New", planned: "Planned", in_progress: "In progress", done: "Done", wont_do: "Won't do" } as const;
export const ROLES = ["Medical student", "PhD / grad student", "Researcher / postdoc", "Clinician", "Faculty", "Other"] as const;
export const RATING_LABELS = ["", "Frustrating", "Not great", "Okay", "Good", "Love it"] as const;

/** App-specific questions. `showIf` hides a question until an earlier answer makes it relevant. */
export type Question = { id: string; label: string; options: readonly string[]; multi?: boolean; showIf?: { id: string; anyOf: readonly string[] } };
export const SURVEY: Record<"choticopy" | "papercards", { title: string; questions: readonly Question[] }> = {
  choticopy: {
    title: "About Choti Copy",
    questions: [
      { id: "cc_anki", label: "Do you use Anki or another flashcard app?", options: ["Yes, Anki", "Yes, another app (Quizlet, RemNote…)", "I tried, but stopped", "No, never"] },
      {
        id: "cc_vs_anki",
        label: "Compared with Anki (or the app you used), Choti Copy is…",
        options: ["Much better", "A bit better", "About the same", "Not as good yet"],
        showIf: { id: "cc_anki", anyOf: ["Yes, Anki", "Yes, another app (Quizlet, RemNote…)", "I tried, but stopped"] },
      },
      { id: "cc_freetime", label: "Would you revise with flashcards made by Choti Copy in your free time, like on the commute or between postings?", options: ["Definitely", "Probably", "Not sure", "Probably not"] },
      { id: "cc_adopt", label: "Will you use Choti Copy for your revision from now on?", options: ["Yes, as my main app", "Alongside Anki or others", "Maybe later", "No"] },
      { id: "cc_recommend", label: "Would you recommend it to a batchmate?", options: ["Yes", "Maybe", "No"] },
    ],
  },
  papercards: {
    title: "About PaperCards",
    questions: [
      { id: "pc_tool", label: "What do you use now to store and read research papers?", multi: true, options: ["Zotero", "Mendeley", "EndNote", "Folders or Google Drive", "Nothing in particular", "Other"] },
      {
        id: "pc_vs_tool",
        label: "Compared with Zotero (or what you use now), PaperCards is…",
        options: ["Much better", "A bit better", "About the same", "Not as good yet"],
        showIf: { id: "pc_tool", anyOf: ["Zotero", "Mendeley", "EndNote", "Folders or Google Drive", "Other"] },
      },
      { id: "pc_adopt", label: "Will you use PaperCards from now on to store and read your research papers?", options: ["Yes, as my main tool", "Alongside my current tool", "Maybe later", "No"] },
      { id: "pc_sections", label: "Are notes split by Introduction, Methods, Results and Discussion useful to you?", options: ["Very useful", "Somewhat", "Not really"] },
      { id: "pc_recommend", label: "Would you recommend it to a labmate?", options: ["Yes", "Maybe", "No"] },
    ],
  },
};
export type Answers = Record<string, string | string[]>;

/** The questions to show for a product choice, with follow-ups hidden until they apply. */
export function questionsFor(product: Product | null, answers: Answers): Question[] {
  if (!product) return [];
  const sets = product === "both" ? [SURVEY.papercards, SURVEY.choticopy] : [SURVEY[product]];
  return sets.flatMap((set) => set.questions.filter((q) => visible(q, answers)));
}
function visible(q: Question, answers: Answers): boolean {
  if (!q.showIf) return true;
  const a = answers[q.showIf.id];
  const picked = Array.isArray(a) ? a : a ? [a] : [];
  return picked.some((x) => q.showIf!.anyOf.includes(x));
}
const ALL_QUESTIONS = new Map([...SURVEY.choticopy.questions, ...SURVEY.papercards.questions].map((q) => [q.id, q]));
export const questionById = (id: string) => ALL_QUESTIONS.get(id);

/** Keeps only known questions for this product, known options, and follow-ups that apply. */
export function cleanAnswers(product: Product, raw: unknown): Answers {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const allowed = new Set(questionsFor(product, Object.fromEntries(Object.entries(src).filter(([, v]) => typeof v === "string" || Array.isArray(v))) as Answers).map((q) => q.id));
  const out: Answers = {};
  for (const [id, v] of Object.entries(src)) {
    const q = ALL_QUESTIONS.get(id);
    if (!q || !allowed.has(id)) continue;
    if (q.multi) {
      const list = (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && q.options.includes(x));
      if (list.length) out[id] = [...new Set(list)];
    } else if (typeof v === "string" && q.options.includes(v)) out[id] = v;
  }
  return out;
}

export type Product = keyof typeof PRODUCTS;
export type Kind = keyof typeof KINDS;
export type Status = keyof typeof STATUSES;
export type FeedbackInput = { product: Product; kind: Kind; rating: number | null; message: string; answers: Answers; name: string | null; email: string | null; role: string | null; page: string | null };
export type FeedbackRow = FeedbackInput & { id: string; created_at: string; updated_at: string; status: Status; admin_note: string | null; user_agent: string | null; user_id: string | null };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Returns a clean row to insert, or an error sentence. */
export function validateFeedback(body: unknown): FeedbackInput | string {
  if (!body || typeof body !== "object") return "Send the form again.";
  const b = body as Record<string, unknown>;
  if (!(typeof b.product === "string" && b.product in PRODUCTS)) return "Choose which app this is about.";
  if (!(typeof b.kind === "string" && b.kind in KINDS)) return "Choose what kind of feedback this is.";
  const answers = cleanAnswers(b.product as Product, b.answers);
  const message = str(b.message, 5000) ?? "";
  if (message.length < 3 && !Object.keys(answers).length) return "Answer a question or write a few words so we know what you think.";
  const rating = typeof b.rating === "number" && Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5 ? b.rating : null;
  const email = str(b.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return "That email address doesn't look right, or leave it empty.";
  return {
    product: b.product as Product,
    kind: b.kind as Kind,
    rating,
    message,
    answers,
    name: str(b.name, 120),
    email: email?.toLowerCase() ?? null,
    role: str(b.role, 80),
    page: str(b.page, 500),
  };
}

export function feedbackCsv(rows: FeedbackRow[]): string {
  const qs = [...ALL_QUESTIONS.values()];
  const head = ["Date", "App", "Type", "Rating", "Message", ...qs.map((q) => q.label), "Name", "Email", "Role", "Status", "Your note"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.created_at.slice(0, 16).replace("T", " "),
      PRODUCTS[r.product],
      KINDS[r.kind],
      r.rating ?? "",
      r.message,
      ...qs.map((q) => {
        const a = r.answers?.[q.id];
        return Array.isArray(a) ? a.join("; ") : (a ?? "");
      }),
      r.name, r.email, r.role, STATUSES[r.status], r.admin_note].map(esc).join(",")
  );
  return "﻿" + [head.map(esc).join(","), ...lines].join("\r\n");
}
