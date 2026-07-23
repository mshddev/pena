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
  workspaceSlug: string;
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
  workspaceSlug,
}: PenaLayoutProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);

  useEffect(() => {
    void fetchWorkspaces()
      .then((response) => setWorkspaces(response.workspaces ?? []))
      .catch(() => setWorkspaces([]));
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand-lockup"
          href={`/workspaces/${workspaceSlug}`}
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
              aria-label="Current workspace"
              value={workspaceSlug}
              onChange={(event) =>
                window.location.assign(`/workspaces/${event.target.value}`)
              }
            >
              {workspaces.length === 0 ? (
                <option value={workspaceSlug}>{workspaceSlug}</option>
              ) : (
                workspaces.map((workspace) => (
                  <option value={workspace.slug} key={workspace.slug}>
                    {workspace.name}
                  </option>
                ))
              )}
            </select>
          </label>
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
