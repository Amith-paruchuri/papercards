import { Suspense } from "react";
import { LibraryApp } from "@/components/LibraryApp";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <LibraryApp />
    </Suspense>
  );
}
