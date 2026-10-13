// Small browser-only effects: the card-to-paper page transition and the highlight that flies into the notes.

type VTDoc = Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> } };

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const CARD_VT = "pc-card";
export const TITLE_VT = "pc-title";

export function clearCardNames() {
  document.querySelectorAll<HTMLElement>(".paper-card[data-vt]").forEach((el) => {
    el.style.viewTransitionName = "";
    el.removeAttribute("data-vt");
    const h = el.querySelector<HTMLElement>("h3");
    if (h) h.style.viewTransitionName = "";
  });
}

export function nameCard(el: HTMLElement) {
  clearCardNames();
  el.dataset.vt = "1";
  el.style.viewTransitionName = CARD_VT;
  const h = el.querySelector<HTMLElement>("h3");
  if (h) h.style.viewTransitionName = TITLE_VT;
}

/** Runs a client navigation inside a View Transition. `ready` is polled each frame until the new page
 *  shows what should morph (it may also name elements), or until the timeout. Falls back to plain navigation. */
export function navigateWithTransition(go: () => void, ready: () => boolean, timeout = 1600) {
  const d = document as VTDoc;
  if (!d.startViewTransition || reduced()) {
    go();
    return;
  }
  document.documentElement.classList.add("vt-paper");
  const vt = d.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        go();
        const t0 = performance.now();
        // Rendering is paused during the update callback, so poll with timers rather than animation frames.
        const tick = () => {
          if (ready() || performance.now() - t0 > timeout) resolve();
          else setTimeout(tick, 16);
        };
        setTimeout(tick, 16);
      })
  );
  vt.finished.finally(() => {
    document.documentElement.classList.remove("vt-paper");
    clearCardNames();
  });
}

/** A copy of the highlighted words arcs from the PDF into the section it was filed under. */
export function flyToNotes(text: string, from: DOMRect, to: HTMLElement | null, color: string) {
  if (!to || reduced() || !from.width) return;
  const target = to.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "fly-ghost";
  ghost.textContent = text.length > 110 ? text.slice(0, 108).trimEnd() + "…" : text;
  ghost.style.setProperty("--sec", color);
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.maxWidth = `${Math.min(320, Math.max(160, from.width))}px`;
  document.body.appendChild(ghost);
  const tx = Math.min(Math.max(target.left + 18, 8), window.innerWidth - 60) - from.left;
  const tyRaw = target.top + Math.min(target.height - 24, 40) - from.top;
  const ty = Math.min(Math.max(tyRaw, 8 - from.top), window.innerHeight - 40 - from.top);
  const lift = Math.min(120, Math.abs(tx) * 0.25 + 40);
  const anim = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 0 },
      { transform: "translate(0, -6px) scale(1.02)", opacity: 1, offset: 0.12 },
      { transform: `translate(${tx * 0.5}px, ${ty * 0.5 - lift}px) scale(0.86)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${tx}px, ${ty}px) scale(0.6)`, opacity: 0 },
    ],
    { duration: 760, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" }
  );
  anim.finished.finally(() => ghost.remove());
  // Make sure the landing spot is visible.
  if (target.bottom < 0 || target.top > window.innerHeight) to.scrollIntoView({ block: "center", behavior: "smooth" });
}
