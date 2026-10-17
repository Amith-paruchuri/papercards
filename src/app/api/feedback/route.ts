import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { validateFeedback } from "@/lib/feedback";

// POST /api/feedback  -> 201. Public (no sign-in needed). A hidden "website" field catches bots, and each address
// may send a handful per 10 minutes. Rows are readable only by the admins listed in public.feedback_admins.
const recent = new Map<string, number[]>();
const WINDOW = 10 * 60 * 1000;
const MAX = 6;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body && typeof body.website === "string" && body.website) return NextResponse.json({ ok: true }, { status: 201 }); // bot: pretend it worked

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const t = Date.now();
  const times = (recent.get(ip) ?? []).filter((x) => t - x < WINDOW);
  if (times.length >= MAX) return NextResponse.json({ error: "Thanks, that's a lot of feedback at once. Try again in a few minutes." }, { status: 429 });

  const row = validateFeedback(body);
  if (typeof row === "string") return NextResponse.json({ error: row }, { status: 400 });

  const supabase = await supabaseServer();
  const { error } = await supabase.from("feedback").insert({ ...row, user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null });
  if (error) {
    console.error("feedback insert failed:", error.code, error.message);
    return NextResponse.json({ error: "We couldn't save that just now. Try again in a minute." }, { status: 502 });
  }
  times.push(t);
  recent.set(ip, times);
  return NextResponse.json({ ok: true }, { status: 201 });
}
