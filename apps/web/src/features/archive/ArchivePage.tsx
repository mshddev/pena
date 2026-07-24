import type { DocumentSummary, WorkspaceSummary } from "@pena/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteDocument,
  fetchArchive,
  fetchWorkspaces,
  restoreDocument,
} from "../../api";
import { UtilityBar } from "../../components/UtilityBar";
import { formatRelativeTime } from "../../format";
import { isSearchShortcut, searchShortcutLabel } from "../../shortcuts";
import type { Notice } from "../document-review/types";

interface ArchivePageProps {
  workspaceSlug: string | null;
}

export function ArchivePage({ workspaceSlug }: ArchivePageProps) {
  const [archivedDocuments, setArchivedDocuments] = useState<
    DocumentSummary[]
  >([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [isScopeOpen, setIsScopeOpen] = useState(false);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [archiveResponse, workspaceResponse] = await Promise.all([
        fetchArchive(workspaceSlug),
        fetchWorkspaces(),
      ]);
      setArchivedDocuments(archiveResponse.documents);
      setWorkspaces(workspaceResponse.workspaces);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the archive.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    window.document.title = workspaceSlug
      ? `Archive · ${workspaceSlug} · Pena`
      : "Archive · Pena";
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (!isSearchShortcut(event)) {
        return;
      }

      event.preventDefault();
      searchRef.current?.focus();
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!isScopeOpen) {
      return;
    }

    function handleDismiss(event: MouseEvent | KeyboardEvent): void {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setIsScopeOpen(false);
        }
        return;
      }

      if (!scopeRef.current?.contains(event.target as Node)) {
        setIsScopeOpen(false);
      }
    }

    window.addEventListener("pointerdown", handleDismiss);
    window.addEventListener("keydown", handleDismiss);
    return () => {
      window.removeEventListener("pointerdown", handleDismiss);
      window.removeEventListener("keydown", handleDismiss);
    };
  }, [isScopeOpen]);

  function workspaceName(slug: string): string {
    return (
      workspaces.find((workspace) => workspace.slug === slug)?.name ??
      formatSlug(slug)
    );
  }

  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (search.length === 0) {
      return archivedDocuments;
    }

    return archivedDocuments.filter((document) => {
      const workspace =
        workspaces.find((entry) => entry.slug === document.workspaceSlug)
          ?.name ?? document.workspaceSlug;

      return (
        document.slug.toLowerCase().includes(search) ||
        formatSlug(document.slug).toLowerCase().includes(search) ||
        document.workspaceSlug.toLowerCase().includes(search) ||
        workspace.toLowerCase().includes(search)
      );
    });
  }, [archivedDocuments, query, workspaces]);

  async function handleRestore(
    documentWorkspaceSlug: string,
    slug: string,
  ): Promise<void> {
    const key = documentKey(documentWorkspaceSlug, slug);
    setRestoringKey(key);
    setNotice(null);

    try {
      await restoreDocument(documentWorkspaceSlug, slug);
      setArchivedDocuments((current) =>
        current.filter(
          (document) =>
            documentKey(document.workspaceSlug, document.slug) !== key,
        ),
      );
      setNotice({
        kind: "success",
        message: `${formatSlug(slug)} restored to ${workspaceName(documentWorkspaceSlug)}.`,
      });
    } catch (restoreError) {
      setNotice({
        kind: "error",
        message:
          restoreError instanceof Error
            ? restoreError.message
            : "Could not restore the document.",
      });
    } finally {
      setRestoringKey(null);
    }
  }

  function beginDelete(workspace: string, slug: string): void {
    setDeleteCandidate(documentKey(workspace, slug));
    setNotice(null);
  }

  function cancelDelete(): void {
    setDeleteCandidate(null);
  }

  async function handleDelete(
    documentWorkspaceSlug: string,
    slug: string,
  ): Promise<void> {
    const key = documentKey(documentWorkspaceSlug, slug);
    setDeletingKey(key);
    setNotice(null);

    try {
      await deleteDocument(documentWorkspaceSlug, slug);
      setArchivedDocuments((current) =>
        current.filter(
          (document) =>
            documentKey(document.workspaceSlug, document.slug) !== key,
        ),
      );
      cancelDelete();
      setNotice({
        kind: "success",
        message: `${formatSlug(slug)} permanently deleted.`,
      });
    } catch (deleteError) {
      setNotice({
        kind: "error",
        message:
          deleteError instanceof Error
            ? deleteError.message
            : "Could not delete the document.",
      });
    } finally {
      setDeletingKey(null);
    }
  }

  const scopeName = workspaceSlug
    ? workspaceName(workspaceSlug)
    : "All workspaces";
  const hasDocuments = archivedDocuments.length > 0;

  return (
    <div className="archive-shell">
      <UtilityBar current="archive" workspaceSlug={workspaceSlug} />

      <main className="archive-main" aria-labelledby="archive-title">
        <header className="archive-heading">
          <div className="archive-scope" ref={scopeRef}>
            <p className="section-label">{scopeName}</p>
            <h1 className="archive-title" id="archive-title">
              <button
                className="archive-scope-trigger"
                type="button"
                aria-expanded={isScopeOpen}
                aria-haspopup="true"
                onClick={() => setIsScopeOpen((current) => !current)}
              >
                Archive · {scopeName}
                <CaretIcon />
              </button>
            </h1>

            {isScopeOpen ? (
              <nav
                className="archive-scope-menu"
                aria-label="Filter the archive by workspace"
              >
                <ScopeOption
                  href="/archive"
                  isActive={workspaceSlug === null}
                  label="All workspaces"
                />
                {workspaces.map((workspace) => (
                  <ScopeOption
                    href={`/archive?workspace=${encodeURIComponent(workspace.slug)}`}
                    isActive={workspaceSlug === workspace.slug}
                    key={workspace.slug}
                    label={workspace.name}
                  />
                ))}
              </nav>
            ) : null}
          </div>

          {!isLoading && !error ? (
            <span className="archive-count">
              {archivedDocuments.length} archived
            </span>
          ) : null}
        </header>

        {!isLoading && !error && hasDocuments ? (
          <div className="archive-search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search the archive"
              placeholder="Search the archive"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            {query.length === 0 ? (
              <kbd className="archive-search-hint" aria-hidden="true">
                {searchShortcutLabel()}
              </kbd>
            ) : null}
          </div>
        ) : null}

        {notice ? (
          <p className={`archive-notice ${notice.kind}`} role="status">
            {notice.message}
          </p>
        ) : null}

        {isLoading ? (
          <div className="archive-loading" aria-label="Loading archive">
            <span />
            <span />
            <span />
          </div>
        ) : error ? (
          <div className="archive-empty-state">
            <span className="archive-empty-glyph" aria-hidden="true">
              <AlertIcon />
            </span>
            <h2>Could not load archive</h2>
            <p>{error}</p>
          </div>
        ) : !hasDocuments ? (
          <div className="archive-empty-state">
            <span className="archive-empty-glyph" aria-hidden="true">
              <ArchiveGlyph />
            </span>
            <h2>Nothing archived yet</h2>
            <p>
              {workspaceSlug
                ? `Documents you archive from ${workspaceName(workspaceSlug)} land here.`
                : "Documents you archive from any workspace land here."}{" "}
              They keep their feedback, and go back to their original workspace
              when you restore them.
            </p>
            <a href={workspaceSlug ? `/workspaces/${workspaceSlug}` : "/"}>
              {workspaceSlug
                ? `Back to ${workspaceName(workspaceSlug)}`
                : "Back to the dashboard"}
            </a>
          </div>
        ) : matches.length === 0 ? (
          <p className="archive-no-matches">
            No archived documents match “{query.trim()}”.
          </p>
        ) : (
          <div className="archive-list">
            <div className="archive-record-labels" aria-hidden="true">
              <span>Archived</span>
              <span>Document</span>
              <span>Details</span>
              <span>Actions</span>
            </div>

            {matches.map((document) => {
              const key = documentKey(document.workspaceSlug, document.slug);
              const isConfirmingDelete = deleteCandidate === key;
              const isRestoring = restoringKey === key;
              const isDeleting = deletingKey === key;

              return (
                <article className="archive-row" key={key}>
                  <div className="archive-record">
                    <div className="archive-date">
                      <span>Archived</span>
                      {document.archivedAt ? (
                        <time dateTime={document.archivedAt}>
                          {formatRelativeTime(document.archivedAt)}
                        </time>
                      ) : (
                        <span>Unknown</span>
                      )}
                    </div>

                    <div className="archive-document-name">
                      <h2>{formatSlug(document.slug)}</h2>
                      <div className="archive-document-meta">
                        <a
                          className="archive-workspace-link"
                          href={`/workspaces/${document.workspaceSlug}`}
                        >
                          {workspaceName(document.workspaceSlug)}
                        </a>
                        <code>{document.workspaceSlug}/{document.slug}</code>
                      </div>
                    </div>

                    <div className="archive-record-meta">
                      <span>Version {document.version}</span>
                      <time dateTime={document.updatedAt}>
                        Updated {formatRelativeTime(document.updatedAt)}
                      </time>
                    </div>

                    <div className="archive-actions">
                      <button
                        className="restore-button"
                        type="button"
                        onClick={() =>
                          void handleRestore(
                            document.workspaceSlug,
                            document.slug,
                          )
                        }
                        disabled={isRestoring || isDeleting}
                      >
                        <RestoreIcon />
                        {isRestoring ? "Restoring" : "Restore"}
                      </button>
                      <button
                        className="permanent-delete-button"
                        type="button"
                        onClick={() =>
                          beginDelete(document.workspaceSlug, document.slug)
                        }
                        disabled={isRestoring || isDeleting}
                      >
                        Delete permanently
                      </button>
                    </div>
                  </div>

                  {isConfirmingDelete ? (
                    <div className="delete-confirmation">
                      <div>
                        <p className="delete-confirmation-title">
                          Permanently delete {formatSlug(document.slug)}?
                        </p>
                        <p>
                          The document, its {document.version} published{" "}
                          {document.version === 1 ? "version" : "versions"} and
                          all of its feedback will be removed. This cannot be
                          undone.
                        </p>
                      </div>
                      <div className="delete-confirmation-actions">
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={cancelDelete}
                          disabled={isDeleting}
                        >
                          Cancel
                        </button>
                        <button
                          className="confirm-delete-button"
                          type="button"
                          onClick={() =>
                            void handleDelete(
                              document.workspaceSlug,
                              document.slug,
                            )
                          }
                          disabled={isDeleting}
                        >
                          {isDeleting ? "Deleting" : "Yes, delete permanently"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

interface ScopeOptionProps {
  href: string;
  isActive: boolean;
  label: string;
}

function ScopeOption({ href, isActive, label }: ScopeOptionProps) {
  return (
    <a
      className={`archive-scope-option${isActive ? " active" : ""}`}
      href={href}
      aria-current={isActive ? "page" : undefined}
    >
      {label}
    </a>
  );
}

function documentKey(workspaceSlug: string, documentSlug: string): string {
  return `${workspaceSlug}/${documentSlug}`;
}

function formatSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function CaretIcon() {
  return (
    <svg className="archive-caret" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6.5 4 4 4-4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="archive-search-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg className="restore-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8a5 5 0 1 0 1.6-3.7" />
      <path d="M2.6 2.6v3h3" />
    </svg>
  );
}

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5.5h11v8h-11z" />
      <path d="M2 2.5h12v3H2z" />
      <path d="M6.5 9h3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8v4" />
      <path d="M8 10.9v.1" />
    </svg>
  );
}
