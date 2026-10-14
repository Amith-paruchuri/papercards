"use client";
// Allowlist sanitizer for rich-text notes (DOM-based, browser only).
const ALLOWED_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI", "H3", "H4", "BLOCKQUOTE", "CODE", "PRE", "A", "IMG", "SUB", "SUP", "MARK",
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "title"]),
  IMG: new Set(["src", "alt", "width", "height"]),
  LI: new Set(["data-hl", "data-ai", "title"]),
};

export function sanitizeHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html || "";
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META"].includes(el.tagName)) {
            el.remove();
            continue;
          }
          // Unwrap unknown elements but keep their text/children.
          walk(el);
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        const allowed = ALLOWED_ATTRS[el.tagName] ?? new Set<string>();
        for (const attr of Array.from(el.attributes)) {
          if (!allowed.has(attr.name)) el.removeAttribute(attr.name);
        }
        if (el.tagName === "A") {
          const href = el.getAttribute("href") || "";
          if (!/^(https?:|mailto:|#|\/)/i.test(href)) el.removeAttribute("href");
          else {
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
          }
        }
        if (el.tagName === "IMG") {
          const src = el.getAttribute("src") || "";
          if (!/^(data:image\/(png|jpe?g|webp|gif);base64,|https:)/i.test(src)) el.remove();
        }
        walk(el);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

export function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  div.querySelectorAll("li").forEach((li) => li.prepend("• "));
  div.querySelectorAll("li, p, div, br, h3, h4").forEach((el) => el.append("\n"));
  return (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Append a highlight bullet (<li data-hl>) to a section's HTML, reusing a trailing list if present. */
export function appendHighlightBullet(html: string, highlightId: string, text: string): string {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  let last = div.lastElementChild;
  while (last && last.tagName === "BR") {
    last.remove();
    last = div.lastElementChild;
  }
  const li = document.createElement("li");
  li.setAttribute("data-hl", highlightId);
  li.textContent = text;
  if (last && last.tagName === "UL") last.appendChild(li);
  else {
    const ul = document.createElement("ul");
    ul.appendChild(li);
    div.appendChild(ul);
  }
  return div.innerHTML;
}

/** Highlight bullets in a section that have not been rewritten by AI yet. */
export function rawHighlightBullets(html: string): { id: string; text: string }[] {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return Array.from(div.querySelectorAll<HTMLElement>("li[data-hl]:not([data-ai])"))
    .map((li) => ({ id: li.getAttribute("data-hl")!, text: (li.textContent || "").trim() }))
    .filter((b) => b.text);
}

/** Puts rewritten text into highlight bullets, keeping the PDF link and the original quote as a tooltip. */
export function rewriteHighlightBullets(html: string, items: { id: string; text: string }[]): string {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  for (const it of items) {
    div.querySelectorAll<HTMLElement>(`li[data-hl="${CSS.escape(it.id)}"]`).forEach((li) => {
      const original = (li.getAttribute("title") || "").replace(/^Original: /, "") || (li.textContent || "").trim();
      li.textContent = it.text;
      li.setAttribute("data-ai", "1");
      li.setAttribute("title", `Original: ${original}`);
    });
  }
  return div.innerHTML;
}

export function removeHighlightBullet(html: string, highlightId: string): string {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  div.querySelectorAll(`li[data-hl="${CSS.escape(highlightId)}"]`).forEach((li) => {
    const ul = li.parentElement;
    li.remove();
    if (ul && (ul.tagName === "UL" || ul.tagName === "OL") && !ul.children.length) ul.remove();
  });
  return div.innerHTML;
}

/** Downscale an image file to a JPEG/PNG data URL so notes stay small. */
export async function imageFileToDataUrl(file: File, maxSide = 1400): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const png = file.type === "image/png" && canvas.width * canvas.height < 400_000;
  return canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.85);
}
