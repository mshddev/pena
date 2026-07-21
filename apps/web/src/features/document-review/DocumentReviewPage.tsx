import {
  parseDecisionDocument,
  type PenaDocument,
} from "@pena/contracts";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  fetchDocument,
  fetchFeedback,
  submitFeedback,
} from "../../api";
import { DocumentViewer } from "./components/DocumentViewer";
import {
  formatFeedbackCount,
  readSubmittedDecisions,
} from "./decision-feedback";
import type {
  DraftComment,
  DraftDecision,
  DraftFeedback,
  Notice,
} from "./types";

interface DocumentReviewPageProps {
  documentSlug: string | null;
}

export function DocumentReviewPage({
  documentSlug,
}: DocumentReviewPageProps) {
  const [currentDocument, setCurrentDocument] = useState<PenaDocument | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(documentSlug !== null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftFeedback, setDraftFeedback] = useState<DraftFeedback[]>([]);
  const [submittedDecisions, setSubmittedDecisions] = useState<
    Record<string, string>
  >({});
  const [notice, setNotice] = useState<Notice>(null);

  const loadDocument = useCallback(async () => {
    if (!documentSlug) {
      return;
    }

    setIsLoading(true);
    setNotice(null);

    try {
      const nextDocument = await fetchDocument(documentSlug);

      if (!nextDocument) {
        setCurrentDocument(null);
        setSubmittedDecisions({});
        return;
      }

      const parsedDocument = parseDecisionDocument(nextDocument.content);
      const nextSubmittedDecisions =
        parsedDocument.decisions.length > 0
          ? readSubmittedDecisions(
              await fetchFeedback(documentSlug),
              parsedDocument.decisions,
            )
          : {};

      setCurrentDocument(nextDocument);
      setSubmittedDecisions(nextSubmittedDecisions);
    } catch (error) {
      setCurrentDocument(null);
      setSubmittedDecisions({});
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not load the document.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [documentSlug]);

  useEffect(() => {
    if (documentSlug) {
      window.document.title = `${documentSlug} · Pena`;
      void loadDocument();
    }
  }, [documentSlug, loadDocument]);

  function handleRefresh(): void {
    if (draftFeedback.length > 0) {
      setNotice({
        kind: "error",
        message: "Submit or remove the draft feedback before refreshing.",
      });
      return;
    }

    void loadDocument();
  }

  function saveDraft(nextDraft: DraftComment): void {
    setDraftFeedback((drafts) => {
      const draftExists = drafts.some((draft) => draft.id === nextDraft.id);
      return draftExists
        ? drafts.map((draft) =>
            draft.id === nextDraft.id ? nextDraft : draft,
          )
        : [...drafts, nextDraft];
    });
  }

  function saveDecisionDraft(
    decisionId: string,
    nextDraft: DraftDecision | null,
  ): void {
    setDraftFeedback((drafts) => {
      const existingIndex = drafts.findIndex(
        (draft) =>
          draft.kind === "decision" && draft.decisionId === decisionId,
      );

      if (!nextDraft) {
        return existingIndex === -1
          ? drafts
          : drafts.filter((_, index) => index !== existingIndex);
      }

      if (existingIndex === -1) {
        return [...drafts, nextDraft];
      }

      return drafts.map((draft, index) =>
        index === existingIndex ? nextDraft : draft,
      );
    });
  }

  async function sendFeedback(): Promise<void> {
    if (!documentSlug || draftFeedback.length === 0) {
      return;
    }

    const submittedDrafts = draftFeedback;
    setIsSubmitting(true);
    setNotice(null);

    try {
      await submitFeedback(documentSlug, {
        comments: submittedDrafts.map(
          ({ selectedText, comment, contextBefore, contextAfter }) => ({
            selectedText,
            comment,
            contextBefore,
            contextAfter,
          }),
        ),
      });
      const submittedIds = new Set(
        submittedDrafts.map((draft) => draft.id),
      );
      const submittedDecisionDrafts = submittedDrafts.filter(
        (draft): draft is DraftDecision => draft.kind === "decision",
      );

      setDraftFeedback((drafts) =>
        drafts.filter((draft) => !submittedIds.has(draft.id)),
      );
      setSubmittedDecisions((current) => ({
        ...current,
        ...Object.fromEntries(
          submittedDecisionDrafts.map((draft) => [
            draft.decisionId,
            draft.choice,
          ]),
        ),
      }));
      setNotice({
        kind: "success",
        message: `${formatFeedbackCount(
          submittedDrafts.length,
        )} submitted. Ask Claude to read your Pena feedback.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not submit feedback.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            P
          </div>
          <div>
            <p className="eyebrow">Local document review</p>
            <h1>Pena</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="local-status">
            <span className="status-dot" aria-hidden="true" />
            Local
          </span>
          <button
            className="quiet-button"
            type="button"
            onClick={handleRefresh}
            disabled={isLoading || !documentSlug}
          >
            <RefreshIcon />
            {isLoading ? "Loading" : "Refresh document"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="document-pane" aria-label="Document">
          <div className="document-meta">
            <div>
              <p className="section-label">Current document</p>
              <p className="document-hint">
                {documentSlug
                  ? "Select any passage to attach a comment."
                  : "Open Pena with a document slug."}
              </p>
            </div>
            <div className="document-identity">
              {documentSlug ? (
                <code className="document-slug">/{documentSlug}</code>
              ) : null}
              {currentDocument ? (
                <>
                  <span className="document-version">
                    Version {currentDocument.version}
                  </span>
                  <time dateTime={currentDocument.updatedAt}>
                    Updated {formatTime(currentDocument.updatedAt)}
                  </time>
                </>
              ) : null}
            </div>
          </div>

          {!documentSlug ? (
            <DocumentState
              glyph="/"
              title="Document slug required"
              description={
                <>
                  Open a direct URL such as{" "}
                  <code>/documents/my-document</code>.
                </>
              }
            />
          ) : isLoading ? (
            <div className="document-state" aria-live="polite">
              <span className="loading-line" />
              <span className="loading-line short" />
              <span className="loading-line" />
            </div>
          ) : currentDocument ? (
            <DocumentViewer
              document={currentDocument}
              draftFeedback={draftFeedback}
              submittedDecisions={submittedDecisions}
              isSubmitting={isSubmitting}
              notice={notice}
              onDraftSaved={saveDraft}
              onDraftDeleted={(draftId) =>
                setDraftFeedback((drafts) =>
                  drafts.filter((draft) => draft.id !== draftId),
                )
              }
              onDecisionDraftChanged={saveDecisionDraft}
              onNoticeClear={() => setNotice(null)}
              onSubmitFeedback={() => void sendFeedback()}
            />
          ) : notice?.kind === "error" ? (
            <DocumentState
              glyph="!"
              title="Could not load document"
              description={notice.message}
            />
          ) : (
            <DocumentState
              glyph="¶"
              title="No document published yet"
              description={
                <>
                  Ask Claude to publish Markdown using the{" "}
                  <strong>{documentSlug}</strong> slug, then refresh this page.
                </>
              }
            />
          )}
        </section>
      </main>
    </div>
  );
}

interface DocumentStateProps {
  glyph: string;
  title: string;
  description: ReactNode;
}

function DocumentState({
  glyph,
  title,
  description,
}: DocumentStateProps) {
  return (
    <div className="document-state empty-state">
      <span className="empty-glyph" aria-hidden="true">
        {glyph}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function formatTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.7 6.4A6.5 6.5 0 1 0 16.5 12" />
      <path d="M15.8 2.8v3.8H12" />
    </svg>
  );
}
