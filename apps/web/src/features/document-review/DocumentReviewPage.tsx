import type { PenaDocument } from "@pena/contracts";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { fetchDocument, submitFeedback } from "../../api";
import { DocumentViewer } from "./components/DocumentViewer";
import type { DraftComment, Notice } from "./types";

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
  const [draftComments, setDraftComments] = useState<DraftComment[]>([]);
  const [notice, setNotice] = useState<Notice>(null);

  const loadDocument = useCallback(async () => {
    if (!documentSlug) {
      return;
    }

    setIsLoading(true);
    setNotice(null);

    try {
      setCurrentDocument(await fetchDocument(documentSlug));
    } catch (error) {
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
    if (draftComments.length > 0) {
      setNotice({
        kind: "error",
        message: "Submit or remove the draft comments before refreshing.",
      });
      return;
    }

    void loadDocument();
  }

  function saveDraft(nextDraft: DraftComment): void {
    setDraftComments((comments) => {
      const draftExists = comments.some(
        (comment) => comment.id === nextDraft.id,
      );
      return draftExists
        ? comments.map((comment) =>
            comment.id === nextDraft.id ? nextDraft : comment,
          )
        : [...comments, nextDraft];
    });
  }

  async function sendFeedback(): Promise<void> {
    if (!documentSlug || draftComments.length === 0) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      await submitFeedback(documentSlug, {
        comments: draftComments.map(
          ({ selectedText, comment, contextBefore, contextAfter }) => ({
            selectedText,
            comment,
            contextBefore,
            contextAfter,
          }),
        ),
      });
      const submittedCount = draftComments.length;
      setDraftComments([]);
      setNotice({
        kind: "success",
        message: `${submittedCount} ${
          submittedCount === 1 ? "comment" : "comments"
        } submitted. Ask Claude to read your Pena feedback.`,
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
                <time dateTime={currentDocument.updatedAt}>
                  Updated {formatTime(currentDocument.updatedAt)}
                </time>
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
              draftComments={draftComments}
              isSubmitting={isSubmitting}
              notice={notice}
              onDraftSaved={saveDraft}
              onDraftDeleted={(draftId) =>
                setDraftComments((comments) =>
                  comments.filter((comment) => comment.id !== draftId),
                )
              }
              onNoticeClear={() => setNotice(null)}
              onSubmitFeedback={() => void sendFeedback()}
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
