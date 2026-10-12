"use client";
import { memo, useEffect, useRef, useState } from "react";
import { imageFileToDataUrl, sanitizeHtml } from "@/lib/sanitize";
import type { NoteSection } from "@/lib/types";

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
    if (ref.current) ref.current.innerHTML = sanitizeHtml(section.content_html);
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
    <div className="section-box">
      <div className="section-head">
        <button
          className="swatch"
          style={{ background: section.color || "var(--rule)" }}
          title="Change colour"
          aria-label={`Change colour of ${section.title}`}
          onClick={() => {
            const i = PALETTE.indexOf(section.color || "");
            p.onColor(section.id, PALETTE[(i + 1) % PALETTE.length]);
          }}
        />
        <input
          className="section-title"
          value={title}
          aria-label="Section name"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title.trim() !== section.title && p.onRename(section.id, title.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <button className="icon-btn" title="Move up" aria-label="Move section up" disabled={p.isFirst} onClick={() => p.onMove(section.id, -1)}>
          ↑
        </button>
        <button className="icon-btn" title="Move down" aria-label="Move section down" disabled={p.isLast} onClick={() => p.onMove(section.id, 1)}>
          ↓
        </button>
        <button className="icon-btn" title="Delete section" aria-label={`Delete section ${section.title}`} onClick={() => p.onDelete(section)}>
          ×
        </button>
      </div>
      <div className="editor">
        <div className="editor-toolbar" onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => cmd("bold")} title="Bold (Cmd/Ctrl+B)">
            <b>B</b>
          </button>
          <button onClick={() => cmd("italic")} title="Italic (Cmd/Ctrl+I)">
            <i>I</i>
          </button>
          <button onClick={() => cmd("underline")} title="Underline">
            <u>U</u>
          </button>
          <button onClick={() => cmd("insertUnorderedList")} title="Bulleted list">
            •≡
          </button>
          <button onClick={() => cmd("insertOrderedList")} title="Numbered list">
            1.
          </button>
          <button onClick={() => cmd("formatBlock", "h4")} title="Heading">
            H
          </button>
          <button onClick={() => fileRef.current?.click()} title="Insert image (or paste one)">
            ▣
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
          <span className="spacer" />
        </div>
        <div
          ref={ref}
          className="rich"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={`${section.title} notes`}
          data-placeholder={`Key points: ${section.title.toLowerCase()}… (select text in the PDF to add bullets here)`}
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
