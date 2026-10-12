// Public Supabase config + Rule 1 isolation guard (never Choti Copy's project).
const FORBIDDEN_REFS = ["nyxivqlpikoffdopfmei"];

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "PaperCards is not configured: copy .env.local.example to .env.local and fill in the PaperCards Supabase URL and anon key."
    );
  }
  if (FORBIDDEN_REFS.some((ref) => url.includes(ref))) {
    throw new Error("Refusing to connect: this Supabase URL belongs to another product (Choti Copy). PaperCards needs its own project.");
  }
  return { url, anonKey };
}

export function isConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
