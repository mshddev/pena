import type { DocumentSummary, WorkspaceSummary } from "@pena/contracts";

interface DocumentIndexProps {
  activeSlug: string | null;
  documents: DocumentSummary[];
  error: string | null;
  isArchiveActive: boolean;
  isLoading: boolean;
  workspaces: WorkspaceSummary[];
  workspaceSlug: string | null;
}

export function DocumentIndex({
  activeSlug,
  documents,
  error,
  isArchiveActive,
  isLoading,
  workspaces,
  workspaceSlug,
}: DocumentIndexProps) {
  if (isArchiveActive) {
    return (
      <aside className="document-index archive-scope-index" aria-label="Archive filters">
        <div className="document-index-heading">
          <div>
            <p className="section-label">Archive</p>
            <p className="archive-scope-hint">Filter by workspace</p>
          </div>
        </div>
        <nav className="archive-scope-list" aria-label="Workspace archive filters">
          <ArchiveScopeLink
            href="/archive"
            isActive={workspaceSlug === null}
            label="All workspaces"
          />
          {workspaces.map((workspace) => (
            <ArchiveScopeLink
              href={`/archive?workspace=${encodeURIComponent(workspace.slug)}`}
              isActive={workspaceSlug === workspace.slug}
              key={workspace.slug}
              label={workspace.name}
            />
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside className="document-index" aria-label="Saved documents">
      <div className="document-index-heading">
        <p className="section-label">Documents</p>
        {!isLoading && !error ? (
          <span className="document-total">{documents.length}</span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="index-loading" aria-label="Loading documents">
          <span />
          <span />
          <span />
        </div>
      ) : error ? (
        <p className="index-message error">{error}</p>
      ) : documents.length === 0 ? (
        <p className="index-message">Published documents will appear here.</p>
      ) : (
        <nav className="document-list">
          {documents.map((document) => {
            const isActive = document.slug === activeSlug;

            return (
              <a
                className={`document-list-item${isActive ? " active" : ""}`}
                href={`/workspaces/${workspaceSlug}/documents/${document.slug}`}
                aria-current={isActive ? "page" : undefined}
                key={document.slug}
              >
                <span className="document-list-title">
                  {formatSlug(document.slug)}
                </span>
                <span className="document-list-meta">
                  <time dateTime={document.updatedAt}>
                    {formatDocumentDate(document.updatedAt)}
                  </time>
                  <span aria-label={`Version ${document.version}`}>
                    v{document.version}
                  </span>
                </span>
                <ArrowIcon />
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

interface ArchiveScopeLinkProps {
  href: string;
  isActive: boolean;
  label: string;
}

function ArchiveScopeLink({ href, isActive, label }: ArchiveScopeLinkProps) {
  return (
    <a
      className={`archive-scope-item${isActive ? " active" : ""}`}
      href={href}
      aria-current={isActive ? "page" : undefined}
    >
      <span>{label}</span>
      <ArrowIcon />
    </a>
  );
}

function formatSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function formatDocumentDate(date: string): string {
  const value = new Date(date);
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };

  if (value.getFullYear() !== new Date().getFullYear()) {
    options.year = "numeric";
  }

  return new Intl.DateTimeFormat(undefined, options).format(value);
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
