import type { CollectionSummary, FeedbackBatch } from "@pena/contracts";
import { useCallback, useEffect, useState } from "react";

import { fetchCollections, fetchDocuments, fetchFeedback } from "../../api";
import { collectionPath } from "../../collections";

import {
  CollectionHome,
  type FeedbackStat,
  type LibraryDocument,
} from "./CollectionHome";

interface HomePageProps {
  /** `null` shows the root; a slug opens that collection like a folder. */
  collectionSlug: string | null;
}

const RECENT_FEEDBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function HomePage({ collectionSlug }: HomePageProps) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
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
      // The whole library is small enough to hold at once, and having every
      // document lets a folder search reach into its subfolders.
      const [collectionResponse, documentResponse] = await Promise.all([
        fetchCollections(),
        fetchDocuments(),
      ]);
      setCollections(collectionResponse.collections ?? []);
      setDocuments(documentResponse.documents ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load documents.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const path = collectionPath(collections, collectionSlug);
    const current = path.at(-1);
    window.document.title =
      collectionSlug === null
        ? "Pena"
        : `${current?.name ?? collectionSlug} · Pena`;
  }, [collectionSlug, collections]);

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
          const response = await fetchFeedback(summary.slug);
          return [summary.slug, summarizeFeedback(response.batches)] as const;
        } catch {
          return [summary.slug, { total: 0, hasRecent: false }] as const;
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
    <CollectionHome
      collections={collections}
      collectionSlug={collectionSlug}
      documents={documents}
      error={error}
      feedbackStats={feedbackStats}
      isLoading={isLoading}
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
