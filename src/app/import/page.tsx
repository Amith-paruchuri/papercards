import type { Metadata } from "next";
import { ImportLegacy } from "@/components/ImportLegacy";

export const metadata: Metadata = { title: "Import" };

export default function ImportPage() {
  return <ImportLegacy />;
}
