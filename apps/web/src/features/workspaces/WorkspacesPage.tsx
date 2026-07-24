import type { WorkspaceSummary } from "@pena/contracts";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  createWorkspace,
  deleteWorkspace,
  fetchWorkspaces,
  renameWorkspace,
} from "../../api";
import { UtilityBar } from "../../components/UtilityBar";
import type { Notice } from "../document-review/types";

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const loadWorkspaces = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetchWorkspaces();
      setWorkspaces(response.workspaces);
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not load workspaces.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    window.document.title = "Workspaces · Pena";
    void loadWorkspaces();
  }, [loadWorkspaces]);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!newName.trim()) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const created = await createWorkspace(newName);
      setNewName("");
      await loadWorkspaces();
      setNotice({
        kind: "success",
        message: `${created.name} created.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not create workspace.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function beginRename(workspace: WorkspaceSummary): void {
    setEditingSlug(workspace.slug);
    setEditingName(workspace.name);
    setDeleteCandidate(null);
    setNotice(null);
  }

  async function handleRename(event: FormEvent, slug: string): Promise<void> {
    event.preventDefault();

    if (!editingName.trim()) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const renamed = await renameWorkspace(slug, editingName);
      setWorkspaces((current) =>
        current.map((workspace) =>
          workspace.slug === slug
            ? { ...workspace, name: renamed.name, updatedAt: renamed.updatedAt }
            : workspace,
        ),
      );
      setEditingSlug(null);
      setNotice({ kind: "success", message: `${renamed.name} saved.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not rename workspace.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function beginDelete(slug: string): void {
    setDeleteCandidate(slug);
    setDeleteConfirmation("");
    setEditingSlug(null);
    setNotice(null);
  }

  async function handleDelete(slug: string): Promise<void> {
    if (deleteConfirmation !== slug) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      await deleteWorkspace(slug);
      setWorkspaces((current) =>
        current.filter((workspace) => workspace.slug !== slug),
      );
      setDeleteCandidate(null);
      setDeleteConfirmation("");
      setNotice({ kind: "success", message: `${slug} deleted.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not delete workspace.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="workspace-admin-shell">
      <UtilityBar current="workspaces" />

      <main className="workspace-admin">
        <header className="workspace-admin-heading">
          <div className="workspace-admin-intro">
            <div className="workspace-admin-copy">
              <p className="section-label">Your review spaces</p>
              <h1>Workspaces</h1>
              <p>Organize documents and feedback by project.</p>
              <p className="workspace-admin-count">
                {isLoading
                  ? "Loading workspace index"
                  : `${workspaces.length} ${
                      workspaces.length === 1 ? "workspace" : "workspaces"
                    }`}
              </p>
            </div>
          </div>

          <form className="workspace-create-form" onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor="workspace-name">New workspace</label>
            <p>Give a new project its own document collection.</p>
            <div>
              <input
                id="workspace-name"
                type="text"
                maxLength={80}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Research"
                autoComplete="off"
              />
              <button type="submit" disabled={isSaving || !newName.trim()}>
                Create
              </button>
            </div>
          </form>
        </header>

        {notice ? (
          <p className={`archive-notice ${notice.kind}`} role="status">
            {notice.message}
          </p>
        ) : null}

        {isLoading ? (
          <div className="workspace-admin-loading" aria-label="Loading workspaces">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className="workspace-records">
            <div className="workspace-record-labels" aria-hidden="true">
              <span>Workspace</span>
              <span>Documents</span>
              <span>Actions</span>
            </div>

            {workspaces.map((workspace) => {
              const isDefault = workspace.slug === "default";
              const isEditing = editingSlug === workspace.slug;
              const isDeleting = deleteCandidate === workspace.slug;

              return (
                <article className="workspace-record" key={workspace.slug}>
                  <div className="workspace-record-main">
                    <div className="workspace-record-name">
                      <span className="workspace-monogram" aria-hidden="true">
                        {workspace.name.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <h2>{workspace.name}</h2>
                        <code>{workspace.slug}</code>
                      </div>
                      {isDefault ? <span className="default-badge">Protected</span> : null}
                    </div>

                    <div className="workspace-document-count">
                      <strong>{workspace.documentCount}</strong>
                      <span>{workspace.documentCount === 1 ? "document" : "documents"}</span>
                    </div>

                    <div className="workspace-record-actions">
                      <a href={`/workspaces/${workspace.slug}`}>Open</a>
                      {!isDefault ? (
                        <>
                          <button type="button" onClick={() => beginRename(workspace)}>
                            Rename
                          </button>
                          <button
                            className="workspace-delete-trigger"
                            type="button"
                            onClick={() => beginDelete(workspace.slug)}
                            disabled={workspace.documentCount > 0}
                            title={
                              workspace.documentCount > 0
                                ? "Remove every active and archived document first."
                                : undefined
                            }
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {isEditing ? (
                    <form
                      className="workspace-inline-editor"
                      onSubmit={(event) => void handleRename(event, workspace.slug)}
                    >
                      <label htmlFor={`rename-${workspace.slug}`}>Workspace name</label>
                      <input
                        id={`rename-${workspace.slug}`}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        maxLength={80}
                        autoFocus
                      />
                      <div>
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() => setEditingSlug(null)}
                        >
                          Cancel
                        </button>
                        <button type="submit" disabled={isSaving || !editingName.trim()}>
                          Save name
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {isDeleting ? (
                    <div className="workspace-delete-confirmation">
                      <div>
                        <strong>Delete {workspace.name}?</strong>
                        <p>Type <code>{workspace.slug}</code> to confirm.</p>
                      </div>
                      <input
                        aria-label={`Type ${workspace.slug} to confirm`}
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        autoFocus
                        autoComplete="off"
                      />
                      <div>
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() => setDeleteCandidate(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="confirm-delete-button"
                          type="button"
                          disabled={isSaving || deleteConfirmation !== workspace.slug}
                          onClick={() => void handleDelete(workspace.slug)}
                        >
                          Delete workspace
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
