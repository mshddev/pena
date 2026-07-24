import type { OutlineSection } from "../outline";

interface DocumentOutlineProps {
  activeSectionId: string | null;
  sections: OutlineSection[];
  workspaceSlug: string | null;
}

export function DocumentOutline({
  activeSectionId,
  sections,
  workspaceSlug,
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

      <a
        className="archive-link"
        href={`/archive?workspace=${encodeURIComponent(workspaceSlug ?? "default")}`}
      >
        <ArchiveIcon />
        <span>Archive</span>
        <ArrowIcon />
      </a>
    </aside>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9" />
      <path d="m9 4 4 4-4 4" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg className="archive-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5h11v8h-11z" />
      <path d="M2 2.5h12V5H2z" />
      <path d="M6 8h4" />
    </svg>
  );
}
