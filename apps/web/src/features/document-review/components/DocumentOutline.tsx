import type { OutlineSection } from "../outline";

interface DocumentOutlineProps {
  activeSectionId: string | null;
  sections: OutlineSection[];
}

export function DocumentOutline({
  activeSectionId,
  sections,
}: DocumentOutlineProps) {
  // Decision headings are nested under their section, so only the top level
  // counts as a section of the document.
  const sectionCount = sections.filter((section) => !section.nested).length;

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

            return (
              <a
                className={`document-outline-item${
                  section.nested ? " nested" : ""
                }${isActive ? " active" : ""}`}
                href={`#${section.id}`}
                aria-current={isActive ? "true" : undefined}
                key={section.id}
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
