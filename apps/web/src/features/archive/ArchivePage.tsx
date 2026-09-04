import type { CollectionSummary, DocumentSummary } from "@pena/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteDocument,
  fetchArchive,
  fetchCollections,
  fetchDocument,
  unarchiveDocument,
} from "../../api";
import {
  buildCollectionTree,
  findCollection,
  flattenCollectionTree,
  formatCollectionPath,
} from "../../collections";
import { UtilityBar } from "../../components/UtilityBar";
import { formatRelativeTime } from "../../format";
import { isSearchShortcut, searchShortcutLabel } from "../../shortcuts";
import {
  archiveHref,
  collectionHref,
  documentHref,
} from "../document-review/routing";
import type { Notice } from "../document-review/types";

interface ArchivePageProps {
  collectionSlug: string | null;
}

export function ArchivePage({ collectionSlug }: ArchivePageProps) {
  const [archivedDocuments, setArchivedDocuments] = useState<
    DocumentSummary[]
  >([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [isScopeOpen, setIsScopeOpen] = useState(false);
  const [restoringSlug, setRestoringSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [archiveResponse, collectionResponse] = await Promise.all([
        fetchArchive(collectionSlug),
        fetchCollections(),
      ]);
      setArchivedDocuments(archiveResponse.documents);
      setCollections(collectionResponse.collections);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the archive.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [collectionSlug]);

  useEffect(() => {
    window.document.title = collectionSlug
      ? `Archive · ${collectionSlug} · Pena`
      : "Archive · Pena";
    void loadDocuments();
  }, [collectionSlug, loadDocuments]);

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

  const scopeOptions = useMemo(
    () => flattenCollectionTree(buildCollectionTree(collections)),
    [collections],
  );

  function collectionName(slug: string | null): string {
    if (slug === null) {
      return "Root";
    }

    return findCollection(collections, slug)?.name ?? formatSlug(slug);
  }

  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (search.length === 0) {
      return archivedDocuments;
    }

    return archivedDocuments.filter((document) => {
      const path = formatCollectionPath(collections, document.collectionSlug);

      return (
        document.slug.toLowerCase().includes(search) ||
        formatSlug(document.slug).toLowerCase().includes(search) ||
        document.title.toLowerCase().includes(search) ||
        (document.collectionSlug ?? "").toLowerCase().includes(search) ||
        path.toLowerCase().includes(search)
      );
    });
  }, [archivedDocuments, collections, query]);

  async function handleRestore(document: DocumentSummary): Promise<void> {
    setRestoringSlug(document.slug);
    setNotice(null);

    try {
      const resource = await fetchDocument(document.slug);

      if (!resource) {
        throw new Error("The archived document no longer exists.");
      }

      await unarchiveDocument(document.slug, resource.etag);
      setArchivedDocuments((current) =>
        current.filter((entry) => entry.slug !== document.slug),
      );
      setNotice({
        kind: "success",
        message:
          document.collectionSlug === null
            ? `${document.title} unarchived at the root.`
            : `${document.title} unarchived in ${collectionName(document.collectionSlug)}.`,
      });
    } catch (restoreError) {
      setNotice({
        kind: "error",
        message:
          restoreError instanceof Error
            ? restoreError.message
            : "Could not unarchive the document.",
      });
    } finally {
      setRestoringSlug(null);
    }
  }

  function beginDelete(slug: string): void {
    setDeleteCandidate(slug);
    setNotice(null);
  }

  function cancelDelete(): void {
    setDeleteCandidate(null);
  }

  async function handleDelete(document: DocumentSummary): Promise<void> {
    setDeletingSlug(document.slug);
    setNotice(null);

    try {
      const resource = await fetchDocument(document.slug);

      if (!resource) {
        throw new Error("The archived document no longer exists.");
      }

      await deleteDocument(document.slug, resource.etag);
      setArchivedDocuments((current) =>
        current.filter((entry) => entry.slug !== document.slug),
      );
      cancelDelete();
      setNotice({
        kind: "success",
        message: `${document.title} permanently deleted.`,
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
      setDeletingSlug(null);
    }
  }

  const scopeName = collectionSlug
    ? collectionName(collectionSlug)
    : "All documents";
  const hasDocuments = archivedDocuments.length > 0;

  return (
    <div className="archive-shell">
      <UtilityBar current="archive" collectionSlug={collectionSlug} />

      <p className="archive-banner">
        <ArchiveGlyph />
        Archived documents keep their feedback and go back to their collection
        when you unarchive them.
      </p>

      <main className="archive-main" aria-labelledby="archive-title">
        <header className="archive-heading">
          <div className="archive-scope" ref={scopeRef}>
            <p className="section-label">{scopeName}</p>
            <h1 className="archive-title" id="archive-title">
              <span className="archive-title-glyph" aria-hidden="true">
                <ArchiveGlyph />
              </span>
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
                aria-label="Filter the archive by collection"
              >
                <ScopeOption
                  href={archiveHref(null)}
                  isActive={collectionSlug === null}
                  label="All documents"
                />
                {scopeOptions.map(({ collection, depth }) => (
                  <ScopeOption
                    href={archiveHref(collection.slug)}
                    isActive={collectionSlug === collection.slug}
                    key={collection.slug}
                    label={`${"  ".repeat(depth)}${collection.name}`}
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
              {collectionSlug
                ? `Documents you archive from ${collectionName(collectionSlug)} land here.`
                : "Documents you archive land here."}{" "}
              They keep their feedback, and go back to their collection when
              you unarchive them.
            </p>
            <a href={collectionHref(collectionSlug)}>
              {collectionSlug
                ? `Back to ${collectionName(collectionSlug)}`
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
              const isConfirmingDelete = deleteCandidate === document.slug;
              const isRestoring = restoringSlug === document.slug;
              const isDeleting = deletingSlug === document.slug;
              const pathLabel = formatCollectionPath(
                collections,
                document.collectionSlug,
              );

              return (
                <article className="archive-row" key={document.slug}>
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
                      <h2>
                        <a href={documentHref(document.slug)}>
                          {document.title}
                        </a>
                      </h2>
                      <div className="archive-document-meta">
                        <a
                          className="archive-collection-link"
                          href={collectionHref(document.collectionSlug)}
                        >
                          {pathLabel || "Root"}
                        </a>
                        <code>{document.slug}</code>
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
                        onClick={() => void handleRestore(document)}
                        disabled={isRestoring || isDeleting}
                      >
                        <RestoreIcon />
                        {isRestoring ? "Unarchiving" : "Unarchive"}
                      </button>
                      <button
                        className="permanent-delete-button"
                        type="button"
                        onClick={() => beginDelete(document.slug)}
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
                          Permanently delete {document.title}?
                        </p>
                        <p>
                          The document, its version history and all of its
                          feedback will be removed. This cannot be undone.
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
                          onClick={() => void handleDelete(document)}
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
