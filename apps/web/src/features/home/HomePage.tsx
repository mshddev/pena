import type { FeedbackBatch, WorkspaceSummary } from "@pena/contracts";
import { useCallback, useEffect, useState } from "react";

import { fetchDocuments, fetchFeedback, fetchWorkspaces } from "../../api";

import {
  WorkspaceHome,
  documentKey,
  type FeedbackStat,
  type LibraryDocument,
} from "./WorkspaceHome";

interface HomePageProps {
  /** `null` shows every workspace; a slug scopes the library to one. */
  workspaceSlug: string | null;
}

const RECENT_FEEDBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function HomePage({ workspaceSlug }: HomePageProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<
    Record<string, FeedbackStat>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWorkspaces();
      const allWorkspaces = response.workspaces ?? [];
      const scoped =
        workspaceSlug === null
          ? allWorkspaces
          : allWorkspaces.filter(
              (workspace) => workspace.slug === workspaceSlug,
            );
      // A scoped route stays readable even when the workspace index is empty.
      const slugs =
        scoped.length > 0
          ? scoped.map((workspace) => workspace.slug)
          : workspaceSlug
            ? [workspaceSlug]
            : [];

      const lists = await Promise.all(
        slugs.map(async (slug) => {
          const documentList = await fetchDocuments(slug);
          return (documentList.documents ?? []).map((summary) => ({
            ...summary,
            workspaceSlug: slug,
          }));
        }),
      );

      setWorkspaces(allWorkspaces);
      setDocuments(lists.flat());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load documents.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    window.document.title =
      workspaceSlug === null ? "Pena" : `${workspaceSlug} · Pena`;
  }, [workspaceSlug]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  // Claude publishes while the window sits in the background, so the library
  // refreshes itself on focus instead of behind a manual button.
  useEffect(() => {
    function handleFocus(): void {
      void loadLibrary();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadLibrary]);

  // Feedback activity is what makes a document worth revisiting, so each card
  // reads its own feedback once the library is known.
  useEffect(() => {
    if (documents.length === 0) {
      return;
    }

    let isCancelled = false;

    void Promise.all(
      documents.map(async (summary) => {
        try {
          const response = await fetchFeedback(
            summary.workspaceSlug,
            summary.slug,
          );
          return [
            documentKey(summary),
            summarizeFeedback(response.batches),
          ] as const;
        } catch {
          return [
            documentKey(summary),
            { total: 0, hasRecent: false },
          ] as const;
        }
      }),
    ).then((entries) => {
      if (!isCancelled) {
        setFeedbackStats(Object.fromEntries(entries));
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [documents]);

  return (
    <WorkspaceHome
      documents={documents}
      error={error}
      feedbackStats={feedbackStats}
      isLoading={isLoading}
      workspaces={workspaces}
      workspaceSlug={workspaceSlug}
    />
  );
}

function summarizeFeedback(batches: FeedbackBatch[] | undefined): FeedbackStat {
  const threshold = Date.now() - RECENT_FEEDBACK_WINDOW_MS;

  return {
    total: (batches ?? []).reduce(
      (count, batch) => count + batch.comments.length,
      0,
    ),
    hasRecent: (batches ?? []).some(
      (batch) => new Date(batch.submittedAt).getTime() >= threshold,
    ),
  };
}
