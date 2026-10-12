// Copies the pdf.js worker into /public so the browser can load it from our own origin.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
mkdirSync("public", { recursive: true });
copyFileSync(join(pkgDir, "build", "pdf.worker.min.mjs"), join("public", "pdf.worker.min.mjs"));
console.log("pdf.js worker copied to public/pdf.worker.min.mjs");
