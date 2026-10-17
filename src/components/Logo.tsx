import Link from "next/link";

/** The mark: three index cards fanned in sumi ink over a vermilion brush sun, the front card stamped with a tick.
 *  Colours come from --logo-ink / --logo-paper / --logo-sun so it follows light and dark themes. */
export function OrigamiMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="origami-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M38.2 5.5c9.8.3 17.5 8.2 17.4 17.9-.1 7.6-4.8 13.8-11.4 16.4-1.6-.4-3.4-.4-5.2.1L27 42.4c-4.7-3.1-7.6-8.6-7.1-14.6.8-12.4 9.2-22.6 18.3-22.3z" fill="var(--logo-sun)"/> <path d="M57.2 15.8c3.2 6.3 2.2 14.6-3.3 20.6-2.1 2.3-4.7 4-7.4 5" fill="none" stroke="var(--logo-sun)" strokeWidth="2" strokeLinecap="round"/> <g transform="translate(3 -4)"><g fill="var(--logo-paper)" stroke="var(--logo-ink)" strokeWidth="3" strokeLinejoin="round"> <rect x="15" y="27" width="18" height="26" rx="2.8" transform="rotate(-30 24 56)"/> <rect x="21" y="24" width="18" height="26" rx="2.8" transform="rotate(-14 30 54)"/> <rect x="28" y="23" width="19" height="27" rx="2.8" transform="rotate(-3 37 50)"/> </g> <path d="M33.8 31.4c0-2.5 1.9-4.4 4.2-4.4 2.3 0 4 1.8 4 4.1 0 2.9-3 5.2-5.4 7.9-1.7-2.3-2.8-4.9-2.8-7.6z" fill="var(--logo-sun)"/> <path d="M34 33.6l2.8 3.8 5.8-7.4" fill="none" stroke="var(--logo-ink)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/> <circle cx="42.9" cy="45.2" r="1.4" fill="none" stroke="var(--logo-ink)" strokeWidth="1.3"/></g>
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="PaperCards, go to library">
      <OrigamiMark size={30} />
      <span className="brand-name">PaperCards</span>
    </Link>
  );
}
