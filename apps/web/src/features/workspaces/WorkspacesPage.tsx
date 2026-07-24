import type { WorkspaceSummary } from "@pena/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  createWorkspace,
  deleteWorkspace,
  fetchWorkspaces,
  renameWorkspace,
} from "../../api";
import { UtilityBar } from "../../components/UtilityBar";
import { formatRelativeTime } from "../../format";
import { isSearchShortcut, searchShortcutLabel } from "../../shortcuts";
import type { Notice } from "../document-review/types";

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [openMenuSlug, setOpenMenuSlug] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (!isSearchShortcut(event)) {
        return;
      }

      event.preventDefault();
      filterRef.current?.focus();
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (isCreating) {
      createRef.current?.focus();
    }
  }, [isCreating]);

  useEffect(() => {
    if (!isCreating) {
      return;
    }

    function handleDismiss(event: MouseEvent | KeyboardEvent): void {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setIsCreating(false);
        }
        return;
      }

      const target = event.target;

      if (!(target instanceof Element) || !target.closest(".workspace-create")) {
        setIsCreating(false);
      }
    }

    window.addEventListener("pointerdown", handleDismiss);
    window.addEventListener("keydown", handleDismiss);
    return () => {
      window.removeEventListener("pointerdown", handleDismiss);
      window.removeEventListener("keydown", handleDismiss);
    };
  }, [isCreating]);

  useEffect(() => {
    if (!openMenuSlug) {
      return;
    }

    function handleDismiss(event: MouseEvent | KeyboardEvent): void {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setOpenMenuSlug(null);
        }
        return;
      }

      const target = event.target;

      if (!(target instanceof Element) || !target.closest(".workspace-card-menu")) {
        setOpenMenuSlug(null);
      }
    }

    window.addEventListener("pointerdown", handleDismiss);
    window.addEventListener("keydown", handleDismiss);
    return () => {
      window.removeEventListener("pointerdown", handleDismiss);
      window.removeEventListener("keydown", handleDismiss);
    };
  }, [openMenuSlug]);

  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();

    return workspaces.filter(
      (workspace) =>
        search.length === 0 ||
        workspace.name.toLowerCase().includes(search) ||
        workspace.slug.toLowerCase().includes(search),
    );
  }, [query, workspaces]);

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
      setIsCreating(false);
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
    setOpenMenuSlug(null);
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
    setOpenMenuSlug(null);
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
          <div className="workspace-admin-copy">
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

          <div className="workspace-create">
            <button
              className="workspace-create-trigger"
              type="button"
              aria-expanded={isCreating}
              aria-haspopup="true"
              onClick={() => {
                setIsCreating((current) => !current);
                setNotice(null);
              }}
            >
              <span aria-hidden="true">+</span>
              New workspace
            </button>

            {isCreating ? (
              <form
                className="workspace-create-form"
                onSubmit={(event) => void handleCreate(event)}
              >
                <label htmlFor="workspace-name">New workspace</label>
                <p>Give a new project its own document collection.</p>
                <input
                  id="workspace-name"
                  ref={createRef}
                  type="text"
                  maxLength={80}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Research"
                  autoComplete="off"
                />
                <div>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setIsCreating(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={isSaving || !newName.trim()}>
                    Create
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </header>

        <div className="workspace-filter">
          <SearchIcon />
          <input
            ref={filterRef}
            type="search"
            aria-label="Filter workspaces"
            placeholder="Filter workspaces"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="workspace-filter-hint" aria-hidden="true">
            {searchShortcutLabel()}
          </kbd>
        </div>

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
        ) : matches.length === 0 ? (
          <p className="workspace-no-matches">
            {query.trim()
              ? `No workspaces match “${query.trim()}”.`
              : "No workspaces yet."}
          </p>
        ) : (
          <div className="workspace-card-grid">
            {matches.map((workspace) => {
              const isDefault = workspace.slug === "default";
              const isEditing = editingSlug === workspace.slug;
              const isDeleting = deleteCandidate === workspace.slug;
              const isMenuOpen = openMenuSlug === workspace.slug;

              return (
                <article className="workspace-card" key={workspace.slug}>
                  <div className="workspace-card-top">
                    <span
                      className="workspace-monogram"
                      style={monogramTint(workspace.slug)}
                      aria-hidden="true"
                    >
                      {workspace.name.charAt(0).toUpperCase()}
                    </span>

                    {isDefault ? null : (
                      <div className="workspace-card-menu">
                        <button
                          className="workspace-menu-trigger"
                          type="button"
                          aria-label={`Actions for ${workspace.name}`}
                          aria-expanded={isMenuOpen}
                          aria-haspopup="true"
                          onClick={() =>
                            setOpenMenuSlug(isMenuOpen ? null : workspace.slug)
                          }
                        >
                          <MoreIcon />
                        </button>

                        {isMenuOpen ? (
                          <div className="workspace-menu">
                            <button
                              type="button"
                              onClick={() => beginRename(workspace)}
                            >
                              Rename
                            </button>
                            <button
                              className="workspace-delete-trigger"
                              type="button"
                              onClick={() => beginDelete(workspace.slug)}
                              disabled={workspace.documentCount > 0}
                              aria-describedby={
                                workspace.documentCount > 0
                                  ? `delete-blocked-${workspace.slug}`
                                  : undefined
                              }
                            >
                              Delete
                              {workspace.documentCount > 0 ? <InfoIcon /> : null}
                            </button>

                            {workspace.documentCount > 0 ? (
                              <p
                                className="workspace-menu-note"
                                id={`delete-blocked-${workspace.slug}`}
                              >
                                Remove every active and archived document
                                first.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="workspace-card-name">
                    <h2>{workspace.name}</h2>
                    {isDefault ? (
                      <span className="default-badge">Protected</span>
                    ) : null}
                  </div>
                  <code className="workspace-card-slug">{workspace.slug}</code>
                  <p className="workspace-card-time">
                    Updated {formatRelativeTime(workspace.updatedAt)}
                  </p>

                  <div className="workspace-card-foot">
                    <div
                      className={`workspace-document-count${
                        workspace.documentCount === 0 ? " empty" : ""
                      }`}
                    >
                      <strong>{workspace.documentCount}</strong>
                      <span>
                        {workspace.documentCount === 1 ? "document" : "documents"}
                      </span>
                    </div>

                    <a
                      className="workspace-open-link"
                      href={`/workspaces/${workspace.slug}`}
                    >
                      Open
                    </a>
                  </div>

                  {isEditing ? (
                    <form
                      className="workspace-inline-editor"
                      onSubmit={(event) =>
                        void handleRename(event, workspace.slug)
                      }
                    >
                      <label htmlFor={`rename-${workspace.slug}`}>
                        Workspace name
                      </label>
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
                        <button
                          type="submit"
                          disabled={isSaving || !editingName.trim()}
                        >
                          Save name
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {isDeleting ? (
                    <div className="workspace-delete-confirmation">
                      <div>
                        <strong>Delete {workspace.name}?</strong>
                        <p>
                          Type <code>{workspace.slug}</code> to confirm.
                        </p>
                      </div>
                      <input
                        aria-label={`Type ${workspace.slug} to confirm`}
                        value={deleteConfirmation}
                        onChange={(event) =>
                          setDeleteConfirmation(event.target.value)
                        }
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
                          disabled={
                            isSaving || deleteConfirmation !== workspace.slug
                          }
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

      <footer className="workspace-admin-footer">
        <a className="home-footer-mark" href="/">
          pena
        </a>
        <span>collaborate and review docs with Claude Code</span>
      </footer>
    </div>
  );
}

/**
 * Colours the monogram from the slug so a workspace keeps the same hue between
 * visits and neighbouring cards stay distinguishable at a glance.
 */
function monogramTint(slug: string): { background: string; color: string } {
  let hue = 0;

  for (let index = 0; index < slug.length; index += 1) {
    hue = (hue * 31 + slug.charCodeAt(index)) % 360;
  }

  return {
    background: `hsl(${hue} 60% 60% / 14%)`,
    color: `hsl(${hue} 72% 76%)`,
  };
}

function SearchIcon() {
  return (
    <svg className="workspace-filter-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="workspace-menu-info" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.4v3.4" />
      <path d="M8 5.2v.1" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="3.4" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="8" cy="12.6" r="1.25" />
    </svg>
  );
}
