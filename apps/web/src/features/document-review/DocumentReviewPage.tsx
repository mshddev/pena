import {
  parseDecisionDocument,
  type DocumentSummary,
  type PenaDocument,
} from "@pena/contracts";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  archiveDocument,
  fetchDocument,
  fetchDocuments,
  fetchFeedback,
  submitFeedback,
} from "../../api";
import { DocumentViewer } from "./components/DocumentViewer";
import { PenaLayout } from "./components/PenaLayout";
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
  workspaceSlug: string;
}

export function DocumentReviewPage({
  documentSlug,
  workspaceSlug,
}: DocumentReviewPageProps) {
  const [currentDocument, setCurrentDocument] = useState<PenaDocument | null>(
    null,
  );
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(documentSlug !== null);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [documentListError, setDocumentListError] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
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
      const nextDocument = await fetchDocument(workspaceSlug, documentSlug);

      if (!nextDocument) {
        setCurrentDocument(null);
        setSubmittedDecisions({});
        return;
      }

      const parsedDocument = parseDecisionDocument(nextDocument.content);
      const nextSubmittedDecisions =
        parsedDocument.decisions.length > 0
          ? readSubmittedDecisions(
              await fetchFeedback(workspaceSlug, documentSlug),
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
  }, [documentSlug, workspaceSlug]);

  const loadDocuments = useCallback(async () => {
    setIsLoadingDocuments(true);
    setDocumentListError(null);

    try {
      const response = await fetchDocuments(workspaceSlug);
      setDocuments(response.documents);
    } catch (error) {
      setDocumentListError(
        error instanceof Error ? error.message : "Could not load documents.",
      );
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (documentSlug) {
      window.document.title = `${documentSlug} · ${workspaceSlug} · Pena`;
      void loadDocument();
    } else {
      window.document.title = `${workspaceSlug} · Pena`;
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

    void loadDocuments();
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
      await submitFeedback(workspaceSlug, documentSlug, {
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

  async function handleArchive(): Promise<void> {
    if (!documentSlug || !currentDocument) {
      return;
    }

    if (draftFeedback.length > 0) {
      setNotice({
        kind: "error",
        message: "Submit or remove the draft feedback before archiving.",
      });
      return;
    }

    setIsArchiving(true);
    setNotice(null);

    try {
      await archiveDocument(workspaceSlug, documentSlug);
      window.location.assign(`/workspaces/${workspaceSlug}`);
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not archive the document.",
      });
      setIsArchiving(false);
    }
  }

  return (
    <PenaLayout
      activeSlug={documentSlug}
      documents={documents}
      documentListError={documentListError}
      isLoadingDocuments={isLoadingDocuments}
      isRefreshing={isLoading || isLoadingDocuments}
      onRefresh={handleRefresh}
      workspaceSlug={workspaceSlug}
    >
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
                <code className="document-slug">
                  /{workspaceSlug}/{documentSlug}
                </code>
              ) : null}
              {currentDocument ? (
                <>
                  <span className="document-version">
                    Version {currentDocument.version}
                  </span>
                  <time dateTime={currentDocument.updatedAt}>
                    Updated {formatTime(currentDocument.updatedAt)}
                  </time>
                  <button
                    className="archive-document-button"
                    type="button"
                    onClick={() => void handleArchive()}
                    disabled={isArchiving}
                  >
                    <ArchiveIcon />
                    {isArchiving ? "Archiving" : "Archive"}
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {!documentSlug ? (
            <DocumentState
              glyph={documents.length > 0 ? "↗" : "/"}
              title={
                documents.length > 0
                  ? "Select a document"
                  : "No documents published yet"
              }
              description={
                documents.length > 0 ? (
                  "Choose a saved document from the index to start reviewing."
                ) : (
                  <>
                    Publish Markdown with the Pena skill. Saved documents will
                    appear in this index automatically.
                  </>
                )
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
    </PenaLayout>
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

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5h11v8h-11z" />
      <path d="M2 2.5h12V5H2z" />
      <path d="M6 8h4" />
    </svg>
  );
}
