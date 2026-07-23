import type { DocumentSummary, WorkspaceSummary } from "@pena/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { fetchWorkspaces } from "../../../api";

import { DocumentIndex } from "./DocumentIndex";

interface PenaLayoutProps {
  activeSlug: string | null;
  children: ReactNode;
  documents: DocumentSummary[];
  documentListError: string | null;
  isArchiveActive?: boolean;
  isLoadingDocuments: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  workspaces?: WorkspaceSummary[];
  workspaceSlug: string | null;
}

export function PenaLayout({
  activeSlug,
  children,
  documents,
  documentListError,
  isArchiveActive = false,
  isLoadingDocuments,
  isRefreshing,
  onRefresh,
  workspaces: providedWorkspaces,
  workspaceSlug,
}: PenaLayoutProps) {
  const [loadedWorkspaces, setLoadedWorkspaces] = useState<WorkspaceSummary[]>(
    [],
  );
  const workspaces = providedWorkspaces ?? loadedWorkspaces;

  useEffect(() => {
    if (providedWorkspaces) {
      return;
    }

    void fetchWorkspaces()
      .then((response) => setLoadedWorkspaces(response.workspaces ?? []))
      .catch(() => setLoadedWorkspaces([]));
  }, [providedWorkspaces]);

  const fallbackWorkspaceSlug = workspaceSlug ?? "default";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand-lockup"
          href={`/workspaces/${fallbackWorkspaceSlug}`}
          aria-label="Pena documents"
        >
          <div className="brand-mark" aria-hidden="true">
            P
          </div>
          <div>
            <p className="eyebrow">Local document review</p>
            <p className="brand-name">Pena</p>
          </div>
        </a>

        <div className="topbar-actions">
          <label className="workspace-switcher">
            <span>Workspace</span>
            <select
              aria-label={
                isArchiveActive ? "Archive workspace filter" : "Current workspace"
              }
              value={workspaceSlug ?? "__all__"}
              onChange={(event) => {
                const nextWorkspace = event.target.value;

                if (isArchiveActive) {
                  window.location.assign(
                    nextWorkspace === "__all__"
                      ? "/archive"
                      : `/archive?workspace=${encodeURIComponent(nextWorkspace)}`,
                  );
                  return;
                }

                window.location.assign(`/workspaces/${nextWorkspace}`);
              }}
            >
              {isArchiveActive ? (
                <option value="__all__">All workspaces</option>
              ) : null}
              {workspaces.length === 0 ? (
                workspaceSlug ? (
                  <option value={workspaceSlug}>{workspaceSlug}</option>
                ) : null
              ) : (
                workspaces.map((workspace) => (
                  <option value={workspace.slug} key={workspace.slug}>
                    {workspace.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <a className="manage-workspaces-link" href="/archive">
            Archive
          </a>
          <a className="manage-workspaces-link" href="/workspaces">
            Manage
          </a>
          <span className="local-status">
            <span className="status-dot" aria-hidden="true" />
            Local
          </span>
          <button
            className="quiet-button"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshIcon />
            {isRefreshing ? "Loading" : "Refresh"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <DocumentIndex
          activeSlug={activeSlug}
          documents={documents}
          error={documentListError}
          isArchiveActive={isArchiveActive}
          isLoading={isLoadingDocuments}
          workspaces={workspaces}
          workspaceSlug={workspaceSlug}
        />
        {children}
      </main>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.7 6.4A6.5 6.5 0 1 0 16.5 12" />
      <path d="M15.8 2.8v3.8H12" />
    </svg>
  );
}
