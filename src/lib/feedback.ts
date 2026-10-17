// Shared shapes and checks for the feedback form (PaperCards and Choti Copy).
export const PRODUCTS = { papercards: "PaperCards", choticopy: "Choti Copy", both: "Both" } as const;
export const KINDS = { bug: "Something's broken", idea: "An idea", love: "Something I love", other: "Other" } as const;
export const STATUSES = { new: "New", planned: "Planned", in_progress: "In progress", done: "Done", wont_do: "Won't do" } as const;
export const ROLES = ["Medical student", "PhD / grad student", "Researcher / postdoc", "Clinician", "Faculty", "Other"] as const;
export const RATING_LABELS = ["", "Frustrating", "Not great", "Okay", "Good", "Love it"] as const;

export type Product = keyof typeof PRODUCTS;
export type Kind = keyof typeof KINDS;
export type Status = keyof typeof STATUSES;
export type FeedbackInput = { product: Product; kind: Kind; rating: number | null; message: string; name: string | null; email: string | null; role: string | null; page: string | null };
export type FeedbackRow = FeedbackInput & { id: string; created_at: string; updated_at: string; status: Status; admin_note: string | null; user_agent: string | null; user_id: string | null };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Returns a clean row to insert, or an error sentence. */
export function validateFeedback(body: unknown): FeedbackInput | string {
  if (!body || typeof body !== "object") return "Send the form again.";
  const b = body as Record<string, unknown>;
  if (!(typeof b.product === "string" && b.product in PRODUCTS)) return "Choose which app this is about.";
  if (!(typeof b.kind === "string" && b.kind in KINDS)) return "Choose what kind of feedback this is.";
  const message = str(b.message, 5000);
  if (!message || message.length < 3) return "Write a few words so we know what you mean.";
  const rating = typeof b.rating === "number" && Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5 ? b.rating : null;
  const email = str(b.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return "That email address doesn't look right, or leave it empty.";
  return {
    product: b.product as Product,
    kind: b.kind as Kind,
    rating,
    message,
    name: str(b.name, 120),
    email: email?.toLowerCase() ?? null,
    role: str(b.role, 80),
    page: str(b.page, 500),
  };
}

export function feedbackCsv(rows: FeedbackRow[]): string {
  const head = ["Date", "App", "Type", "Rating", "Message", "Name", "Email", "Role", "Status", "Your note"];
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.created_at.slice(0, 16).replace("T", " "), PRODUCTS[r.product], KINDS[r.kind], r.rating ?? "", r.message, r.name, r.email, r.role, STATUSES[r.status], r.admin_note].map(q).join(",")
  );
  return "﻿" + [head.map(q).join(","), ...lines].join("\r\n");
}
