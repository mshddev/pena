import type { DocumentSummary, WorkspaceSummary } from "@pena/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  deleteDocument,
  fetchArchive,
  fetchWorkspaces,
  restoreDocument,
} from "../../api";
import { PenaLayout } from "../document-review/components/PenaLayout";
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
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

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
    setDeleteConfirmation("");
    setNotice(null);
  }

  function cancelDelete(): void {
    setDeleteCandidate(null);
    setDeleteConfirmation("");
  }

  async function handleDelete(
    documentWorkspaceSlug: string,
    slug: string,
  ): Promise<void> {
    const key = documentKey(documentWorkspaceSlug, slug);

    if (deleteConfirmation !== key) {
      return;
    }

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

  function workspaceName(slug: string): string {
    return (
      workspaces.find((workspace) => workspace.slug === slug)?.name ??
      formatSlug(slug)
    );
  }

  return (
    <PenaLayout
      activeSlug={null}
      documents={[]}
      documentListError={error}
      isArchiveActive
      isLoadingDocuments={isLoading}
      isRefreshing={isLoading}
      onRefresh={() => void loadDocuments()}
      workspaces={workspaces}
      workspaceSlug={workspaceSlug}
    >
      <section className="archive-pane" aria-labelledby="archive-title">
        <header className="archive-heading">
          <div>
            <p className="section-label">
              {workspaceSlug ? workspaceName(workspaceSlug) : "All workspaces"}
            </p>
            <h1 id="archive-title">Archive</h1>
            <p>
              Documents stay connected to their original workspace when restored.
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
            <p>
              {workspaceSlug
                ? `No documents from ${workspaceName(workspaceSlug)} are archived.`
                : "Documents you archive from any workspace will appear here."}
            </p>
            <a href={workspaceSlug ? `/workspaces/${workspaceSlug}` : "/workspaces/default"}>
              Return to documents
            </a>
          </div>
        ) : (
          <div className="archive-list">
            {archivedDocuments.map((document) => {
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
                          {formatDate(document.archivedAt)}
                        </time>
                      ) : (
                        <span>Unknown</span>
                      )}
                    </div>

                    <div className="archive-document-name">
                      <h2>{formatSlug(document.slug)}</h2>
                      <a
                        className="archive-workspace-link"
                        href={`/workspaces/${document.workspaceSlug}`}
                      >
                        {workspaceName(document.workspaceSlug)}
                      </a>
                      <code>{document.workspaceSlug}/{document.slug}</code>
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
                        onClick={() =>
                          void handleRestore(
                            document.workspaceSlug,
                            document.slug,
                          )
                        }
                        disabled={isRestoring || isDeleting}
                      >
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
                          The document and all of its feedback will be removed.
                          This cannot be undone.
                        </p>
                      </div>
                      <label htmlFor={`delete-${document.workspaceSlug}-${document.slug}`}>
                        Type <code>{key}</code> to confirm
                      </label>
                      <input
                        id={`delete-${document.workspaceSlug}-${document.slug}`}
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
                          onClick={() =>
                            void handleDelete(
                              document.workspaceSlug,
                              document.slug,
                            )
                          }
                          disabled={
                            deleteConfirmation !== key || isDeleting
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

function documentKey(workspaceSlug: string, documentSlug: string): string {
  return `${workspaceSlug}/${documentSlug}`;
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
