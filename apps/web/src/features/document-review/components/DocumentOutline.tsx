import type { CSSProperties } from "react";

import type { OutlineSection } from "../outline";

interface DocumentOutlineProps {
  activeSectionId: string | null;
  sections: OutlineSection[];
}

export function DocumentOutline({
  activeSectionId,
  sections,
}: DocumentOutlineProps) {
  const sectionCount = sections.filter((section) => section.depth === 0).length;

  return (
    <aside className="document-index" aria-label="Document outline">
      <div className="document-index-heading">
        <p className="section-label">Outline</p>
        {sectionCount > 0 ? (
          <span className="document-total">{sectionCount}</span>
        ) : null}
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
