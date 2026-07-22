import type { DocumentSummary } from "@pena/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  deleteDocument,
  fetchDocuments,
  restoreDocument,
} from "../../api";
import { PenaLayout } from "../document-review/components/PenaLayout";
import type { Notice } from "../document-review/types";

export function ArchivePage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [archivedDocuments, setArchivedDocuments] = useState<
    DocumentSummary[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [restoringSlug, setRestoringSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [activeResponse, archivedResponse] = await Promise.all([
        fetchDocuments(),
        fetchDocuments("archived"),
      ]);
      setDocuments(activeResponse.documents);
      setArchivedDocuments(archivedResponse.documents);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the archive.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    window.document.title = "Archive · Pena";
    void loadDocuments();
  }, [loadDocuments]);

  async function handleRestore(slug: string): Promise<void> {
    setRestoringSlug(slug);
    setNotice(null);

    try {
      const restoredDocument = await restoreDocument(slug);
      setArchivedDocuments((current) =>
        current.filter((document) => document.slug !== slug),
      );
      setDocuments((current) => [restoredDocument, ...current]);
      setNotice({
        kind: "success",
        message: `${formatSlug(slug)} restored to Documents.`,
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
      setRestoringSlug(null);
    }
  }

  function beginDelete(slug: string): void {
    setDeleteCandidate(slug);
    setDeleteConfirmation("");
    setNotice(null);
  }

  function cancelDelete(): void {
    setDeleteCandidate(null);
    setDeleteConfirmation("");
  }

  async function handleDelete(slug: string): Promise<void> {
    if (deleteConfirmation !== slug) {
      return;
    }

    setDeletingSlug(slug);
    setNotice(null);

    try {
      await deleteDocument(slug);
      setArchivedDocuments((current) =>
        current.filter((document) => document.slug !== slug),
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
      setDeletingSlug(null);
    }
  }

  return (
    <PenaLayout
      activeSlug={null}
      documents={documents}
      documentListError={error}
      isArchiveActive
      isLoadingDocuments={isLoading}
      isRefreshing={isLoading}
      onRefresh={() => void loadDocuments()}
    >
      <section className="archive-pane" aria-labelledby="archive-title">
        <header className="archive-heading">
          <div>
            <p className="section-label">Saved records</p>
            <h1 id="archive-title">Archive</h1>
            <p>
              Restore documents to active review or permanently remove them.
            </p>
          </div>
          {!isLoading && !error ? (
            <span className="archive-count">
              {archivedDocuments.length} archived
            </span>
          ) : null}
        </header>

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
            <span aria-hidden="true">!</span>
            <h2>Could not load archive</h2>
            <p>{error}</p>
          </div>
        ) : archivedDocuments.length === 0 ? (
          <div className="archive-empty-state">
            <span aria-hidden="true">□</span>
            <h2>The archive is empty</h2>
            <p>Documents you archive will remain available here.</p>
            <a href="/">Return to documents</a>
          </div>
        ) : (
          <div className="archive-list">
            {archivedDocuments.map((document) => {
              const isConfirmingDelete = deleteCandidate === document.slug;
              const isRestoring = restoringSlug === document.slug;
              const isDeleting = deletingSlug === document.slug;

              return (
                <article className="archive-row" key={document.slug}>
                  <div className="archive-record">
                    <div className="archive-date">
                      <span>Archived</span>
                      {document.archivedAt ? (
                        <time dateTime={document.archivedAt}>
                          {formatDate(document.archivedAt)}
                        </time>
                      ) : (
                        <span>Unknown</span>
                      )}
                    </div>

                    <div className="archive-document-name">
                      <h2>{formatSlug(document.slug)}</h2>
                      <code>/{document.slug}</code>
                    </div>

                    <div className="archive-record-meta">
                      <span>Version {document.version}</span>
                      <time dateTime={document.updatedAt}>
                        Updated {formatDate(document.updatedAt)}
                      </time>
                    </div>

                    <div className="archive-actions">
                      <button
                        className="restore-button"
                        type="button"
                        onClick={() => void handleRestore(document.slug)}
                        disabled={isRestoring || isDeleting}
                      >
                        {isRestoring ? "Restoring" : "Restore"}
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
                          Permanently delete {formatSlug(document.slug)}?
                        </p>
                        <p>
                          The document and all of its feedback will be removed.
                          This cannot be undone.
                        </p>
                      </div>
                      <label htmlFor={`delete-${document.slug}`}>
                        Type <code>{document.slug}</code> to confirm
                      </label>
                      <input
                        id={`delete-${document.slug}`}
                        type="text"
                        value={deleteConfirmation}
                        onChange={(event) =>
                          setDeleteConfirmation(event.target.value)
                        }
                        autoComplete="off"
                        autoFocus
                      />
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
                          onClick={() => void handleDelete(document.slug)}
                          disabled={
                            deleteConfirmation !== document.slug || isDeleting
                          }
                        >
                          {isDeleting ? "Deleting" : "Delete permanently"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </PenaLayout>
  );
}

function formatSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}
