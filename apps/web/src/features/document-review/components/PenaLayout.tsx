import type { DocumentSummary } from "@pena/contracts";
import type { ReactNode } from "react";

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
}: PenaLayoutProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="/" aria-label="Pena documents">
          <div className="brand-mark" aria-hidden="true">
            P
          </div>
          <div>
            <p className="eyebrow">Local document review</p>
            <p className="brand-name">Pena</p>
          </div>
        </a>

        <div className="topbar-actions">
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
