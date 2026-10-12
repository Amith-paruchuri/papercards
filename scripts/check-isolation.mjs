// Rule 1 guard: refuse to run against Choti Copy's (or any non-PaperCards) Supabase project.
import { existsSync, readFileSync } from "node:fs";

const FORBIDDEN_REFS = ["nyxivqlpikoffdopfmei"]; // Choti Copy. Never connect.
const files = [".env.local", ".env", ".env.development.local", ".env.production.local", "supabase/.temp/project-ref"];
let bad = false;
for (const f of files) {
  if (!existsSync(f)) continue;
  const text = readFileSync(f, "utf8");
  for (const ref of FORBIDDEN_REFS) {
    if (text.includes(ref)) {
      console.error(`\n[isolation] STOP: ${f} references a forbidden Supabase project (Choti Copy). PaperCards must use its own project.\n`);
      bad = true;
    }
  }
}
for (const ref of FORBIDDEN_REFS) {
  if ((process.env.NEXT_PUBLIC_SUPABASE_URL || "").includes(ref)) {
    console.error("\n[isolation] STOP: NEXT_PUBLIC_SUPABASE_URL points at Choti Copy's Supabase project.\n");
    bad = true;
  }
}
if (bad) process.exit(1);
