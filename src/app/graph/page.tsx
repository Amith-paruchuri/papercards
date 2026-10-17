import type { Metadata } from "next";
import { Suspense } from "react";
import { GraphApp } from "@/components/GraphApp";

export const metadata: Metadata = { title: "Research graph" };

export default function GraphPage() {
  return (
    <Suspense fallback={null}>
      <GraphApp />
    </Suspense>
  );
}
