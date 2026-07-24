import type { DocumentSummary } from "@pena/contracts";
import { type ReactNode } from "react";

import { UtilityBar } from "../../../components/UtilityBar";

import { DocumentIndex } from "./DocumentIndex";

interface PenaLayoutProps {
  activeSlug: string | null;
  children: ReactNode;
  documents: DocumentSummary[];
  documentListError: string | null;
  isLoadingDocuments: boolean;
  workspaceSlug: string | null;
}

export function PenaLayout({
  activeSlug,
  children,
  documents,
  documentListError,
  isLoadingDocuments,
  workspaceSlug,
}: PenaLayoutProps) {
  return (
    <div className="app-shell">
      <UtilityBar current={null} workspaceSlug={workspaceSlug} />

      <main className="workspace">
        <DocumentIndex
          activeSlug={activeSlug}
          documents={documents}
          error={documentListError}
          isLoading={isLoadingDocuments}
          workspaceSlug={workspaceSlug}
        />
        {children}
      </main>
    </div>
  );
}
