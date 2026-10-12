import Link from "next/link";

/** The mark is the product: an index card with its corner folded, stamped with a small vermilion seal. */
export function OrigamiMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="origami-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 5.5h15.5L27 12v14.5a1.5 1.5 0 0 1-1.5 1.5h-19A1.5 1.5 0 0 1 5 26.5v-21z" fill="var(--ink)" />
      <path d="M20.5 5.5V12H27z" fill="var(--accent)" />
      <path d="M20.5 5.5V12H27" fill="none" stroke="var(--bg)" strokeWidth="0.8" strokeLinejoin="round" />
      <rect x="8.5" y="20.5" width="4.5" height="4.5" rx="1" fill="var(--seal)" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="PaperCards, go to library">
      <OrigamiMark />
      <span className="brand-name">PaperCards</span>
    </Link>
  );
}
