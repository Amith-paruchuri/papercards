"use client";
import { FilePdf, Star } from "@phosphor-icons/react";
import { formatAuthorShort } from "@/lib/citations";
import { STATUS_LABELS, type LibraryPaper, type Tag } from "@/lib/types";

/** The signature element: an index card whose folded corner shows reading status
 *  and whose bottom strip shows which note sections have content. */
export function PaperCard({
  paper,
  tagById,
  selected,
  onOpen,
  onToggle,
  onDragStart,
  static: isStatic,
}: {
  paper: Pick<LibraryPaper, "id" | "title" | "authors" | "year" | "journal" | "abstract" | "status" | "priority" | "pdf_path"> & Partial<Pick<LibraryPaper, "paper_tags" | "note_sections">>;
  tagById?: Map<string, Tag>;
  selected?: boolean;
  onOpen?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onToggle?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  static?: boolean;
}) {
  const sections = [...(paper.note_sections ?? [])].sort((a, b) => a.position - b.position);
  const author = formatAuthorShort(paper.authors);
  return (
    <article
      className={`paper-card${selected ? " selected" : ""}`}
      data-status={paper.status}
      onClick={onOpen}
      onKeyDown={(e) => !isStatic && e.key === "Enter" && onOpen?.(e)}
      draggable={!isStatic}
      onDragStart={onDragStart}
      onPointerMove={
        isStatic
          ? undefined
          : (e) => {
              // Soft light that follows the cursor; CSS variables only, no re-render.
              const el = e.currentTarget;
              const r = el.getBoundingClientRect();
              el.style.setProperty("--mx", `${e.clientX - r.left}px`);
              el.style.setProperty("--my", `${e.clientY - r.top}px`);
            }
      }
      tabIndex={isStatic ? -1 : 0}
      aria-label={isStatic ? undefined : `${paper.title}. ${STATUS_LABELS[paper.status]}.`}
    >
      {!isStatic && onToggle && (
        <label className="select-box" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={Boolean(selected)} onChange={onToggle} aria-label={`Select “${paper.title}”`} />
        </label>
      )}
      <h3>{paper.title}</h3>
      <div className="byline">
        {author || "Unknown authors"}
        {paper.year ? `, ${paper.year}` : ""}
        {paper.journal ? (
          <>
            {". "}
            <em>{paper.journal}</em>
          </>
        ) : null}
      </div>
      {paper.abstract && <div className="abstract">{paper.abstract}</div>}
      <div className="foot">
        {(paper.paper_tags ?? []).slice(0, 3).map((t) => {
          const tag = tagById?.get(t.tag_id);
          return tag ? (
            <span key={t.tag_id} className="tag">
              {tag.name}
            </span>
          ) : null;
        })}
        <span className="spacer" />
        <span className="meta-icons">
          {paper.priority > 0 && (
            <span className="priority-stars" title={`Priority ${paper.priority} of 3`} aria-label={`Priority ${paper.priority} of 3`}>
              {Array.from({ length: paper.priority }, (_, i) => (
                <Star key={i} size={12} weight="fill" />
              ))}
            </span>
          )}
          {paper.pdf_path && <FilePdf size={16} aria-label="PDF attached" />}
        </span>
        <span className="status-word">{STATUS_LABELS[paper.status]}</span>
      </div>
      {sections.length > 0 && (
        <div className="coverage" aria-hidden="true" title="Notes per section">
          {sections.map((s) => (
            <i key={s.id} className={s.has_notes ? "on" : ""} style={{ "--sec": s.color || "var(--accent)" } as React.CSSProperties} />
          ))}
        </div>
      )}
    </article>
  );
}
