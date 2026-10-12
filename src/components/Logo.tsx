import Link from "next/link";

export function OrigamiMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="origami-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M8 52 L32 8 L56 52 Z" fill="var(--ink)" />
      <path d="M32 8 L56 52 L32 42 Z" fill="var(--accent)" />
      <path d="M8 52 L32 42 L56 52 Z" fill="var(--ink-soft)" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="PaperCards home">
      <OrigamiMark />
      <span className="brand-name">
        PaperCards
        <small>your research brain</small>
      </span>
    </Link>
  );
}
