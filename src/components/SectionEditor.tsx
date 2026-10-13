"use client";
import { memo, useEffect, useRef, useState } from "react";
import { imageFileToDataUrl, sanitizeHtml } from "@/lib/sanitize";
import type { NoteSection } from "@/lib/types";
import { ArrowDown, ArrowUp, ImageSquare, ListBullets, ListNumbers, TextB, TextH, TextItalic, TextUnderline, Trash } from "@phosphor-icons/react";

const PALETTE = ["#5ec4ee", "#7ed67e", "#f0c463", "#f0879b", "#b59cf0", "#f5a25d", "#9aa3ad"];

type Props = {
  section: NoteSection;
  /** Bumped by the parent when it changes content_html from outside (e.g. a new highlight bullet). */
  externalVersion: number;
  onChange: (id: string, html: string) => void;
  onRename: (id: string, title: string) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (section: NoteSection) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onJump: (highlightId: string) => void;
  isFirst: boolean;
  isLast: boolean;
};

export const SectionEditor = memo(function SectionEditor(p: Props) {
  const { section } = p;
  const ref = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(section.title);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load content on mount and whenever the parent pushes an external change; never while the user types.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = sanitizeHtml(section.content_html);
    // A highlight just landed here: let the newest bullet ink in so you can see where it went.
    if (p.externalVersion > 0) {
      const last = el.querySelector("li[data-hl]:last-of-type");
      if (last) {
        last.classList.add("just-added");
        setTimeout(() => last.classList.remove("just-added"), 1700);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id, p.externalVersion]);

  useEffect(() => setTitle(section.title), [section.title]);

  const emit = () => {
    if (ref.current) p.onChange(section.id, sanitizeHtml(ref.current.innerHTML));
  };

  const cmd = (command: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, value);
    emit();
  };

  async function insertImages(files: File[]) {
    for (const f of files.filter((x) => x.type.startsWith("image/"))) {
      const url = await imageFileToDataUrl(f);
      ref.current?.focus();
      document.execCommand("insertHTML", false, `<img src="${url}" alt="${f.name.replace(/"/g, "")}">`);
    }
    emit();
  }

  return (
    <div className="section-box" data-section={section.id} style={{ "--sec": section.color || "var(--line-strong)" } as React.CSSProperties}>
      <div className="section-head">
        <button
          className="swatch"
          style={{ background: section.color || "var(--line-strong)" }}
          title="Change colour"
          aria-label={`Change colour of ${section.title}`}
          onClick={() => {
            const i = PALETTE.indexOf(section.color || "");
            p.onColor(section.id, PALETTE[(i + 1) % PALETTE.length]);
          }}
        />
        <input
          type="text"
          className="section-title"
          value={title}
          aria-label="Section name"
          name="section-title"
          autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title.trim() !== section.title && p.onRename(section.id, title.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <button className="icon-btn sm" title="Move up" aria-label={`Move ${section.title} up`} disabled={p.isFirst} onClick={() => p.onMove(section.id, -1)}>
          <ArrowUp size={14} />
        </button>
        <button className="icon-btn sm" title="Move down" aria-label={`Move ${section.title} down`} disabled={p.isLast} onClick={() => p.onMove(section.id, 1)}>
          <ArrowDown size={14} />
        </button>
        <button className="icon-btn sm" title="Delete section" aria-label={`Delete section ${section.title}`} onClick={() => p.onDelete(section)}>
          <Trash size={14} />
        </button>
      </div>
      <div className="editor">
        <div className="editor-toolbar" onMouseDown={(e) => e.preventDefault()} role="toolbar" aria-label={`Format ${section.title} notes`}>
          <button onClick={() => cmd("bold")} title="Bold (⌘B)" aria-label="Bold">
            <TextB size={16} weight="bold" />
          </button>
          <button onClick={() => cmd("italic")} title="Italic (⌘I)" aria-label="Italic">
            <TextItalic size={16} />
          </button>
          <button onClick={() => cmd("underline")} title="Underline (⌘U)" aria-label="Underline">
            <TextUnderline size={16} />
          </button>
          <button onClick={() => cmd("insertUnorderedList")} title="Bulleted list" aria-label="Bulleted list">
            <ListBullets size={16} />
          </button>
          <button onClick={() => cmd("insertOrderedList")} title="Numbered list" aria-label="Numbered list">
            <ListNumbers size={16} />
          </button>
          <button onClick={() => cmd("formatBlock", "h4")} title="Subheading" aria-label="Subheading">
            <TextH size={16} />
          </button>
          <button onClick={() => fileRef.current?.click()} title="Add an image (or paste one)" aria-label="Add image">
            <ImageSquare size={16} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void insertImages(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </div>
        <div
          ref={ref}
          className="rich"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={`${section.title} notes`}
          data-placeholder={`Write about the ${section.title.toLowerCase()}, or select text in the PDF to add it here…`}
          onInput={emit}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
            if (imgs.length) {
              e.preventDefault();
              void insertImages(imgs);
              return;
            }
            // Paste as plain text to avoid dragging in foreign styles.
            const text = e.clipboardData.getData("text/plain");
            if (text) {
              e.preventDefault();
              document.execCommand("insertText", false, text);
            }
          }}
          onDrop={(e) => {
            const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
            if (imgs.length) {
              e.preventDefault();
              void insertImages(imgs);
            }
          }}
          onClick={(e) => {
            const li = (e.target as HTMLElement).closest("li[data-hl]");
            if (li && !window.getSelection()?.toString()) p.onJump(li.getAttribute("data-hl")!);
          }}
        />
      </div>
    </div>
  );
});
