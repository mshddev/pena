import type { CSSProperties } from "react";

import type { OutlineSection } from "../outline";

interface DocumentOutlineProps {
  activeSectionId: string | null;
  isOpen: boolean;
  onCollapse: () => void;
  sections: OutlineSection[];
}

export function DocumentOutline({
  activeSectionId,
  isOpen,
  onCollapse,
  sections,
}: DocumentOutlineProps) {
  const sectionCount = sections.filter((section) => section.depth === 0).length;

  return (
    <aside
      aria-hidden={!isOpen}
      aria-label="Document outline"
      className="document-index"
      id="document-outline-panel"
    >
      <div className="document-index-heading">
        <p className="section-label">Outline</p>
        <div className="document-index-actions">
          {sectionCount > 0 ? (
            <span className="document-total">{sectionCount}</span>
          ) : null}
          <button
            aria-label="Hide document outline"
            className="outline-collapse-button"
            onClick={onCollapse}
            title="Hide document outline"
            type="button"
          >
            <CollapseOutlineIcon />
          </button>
        </div>
      </div>

      {sections.length === 0 ? (
        <p className="index-message">
          Headings in this document will appear here.
        </p>
      ) : (
        <nav className="document-outline">
          {sections.map((section) => {
            const isActive = section.id === activeSectionId;
            // The rail is narrow. Preserve the hierarchy without letting a
            // malformed heading jump squeeze a label into a vertical strip.
            const indentDepth = Math.min(section.depth, 3);
            const outlineStyle = {
              "--outline-indent": `${indentDepth * 12}px`,
            } as CSSProperties;

            return (
              <a
                className={`document-outline-item${
                  section.depth > 0 ? " nested" : ""
                }${isActive ? " active" : ""}`}
                href={`#${section.id}`}
                aria-current={isActive ? "true" : undefined}
                data-depth={section.depth}
                key={section.id}
                style={outlineStyle}
              >
                {section.text}
              </a>
            );
          })}
        </nav>
      )}
    </aside>
  );
}

function CollapseOutlineIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M3 3h10v10H3zM7 3v10M11 6l-2 2 2 2" />
    </svg>
  );
}
