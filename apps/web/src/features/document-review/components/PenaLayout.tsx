import type { DocumentSummary, WorkspaceSummary } from "@pena/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { fetchWorkspaces } from "../../../api";
import { UtilityBar } from "../../../components/UtilityBar";

import { DocumentIndex } from "./DocumentIndex";

interface PenaLayoutProps {
  activeSlug: string | null;
  children: ReactNode;
  documents: DocumentSummary[];
  documentListError: string | null;
  isArchiveActive?: boolean;
  isLoadingDocuments: boolean;
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

  return (
    <div className="app-shell">
      <UtilityBar
        current={isArchiveActive ? "archive" : null}
        workspaceSlug={workspaceSlug}
      />

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
