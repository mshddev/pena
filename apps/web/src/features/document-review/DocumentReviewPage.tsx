import {
  parseDecisionDocument,
  type CollectionSummary,
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
  fetchCollections,
  fetchDocument,
  fetchFeedback,
  moveDocument,
  submitFeedback,
} from "../../api";
import {
  buildCollectionTree,
  collectionPath,
  flattenCollectionTree,
  formatCollectionPath,
} from "../../collections";
import { formatClockTime, formatRelativeTime } from "../../format";
import { isSubmitAllShortcut } from "../../shortcuts";
import { DocumentViewer } from "./components/DocumentViewer";
import { PenaLayout } from "./components/PenaLayout";
import {
  ReadOnlyDocument,
  VersionHistory,
} from "./components/VersionHistory";
import {
  formatFeedbackCount,
  readSubmittedDecisions,
} from "./decision-feedback";
import { downloadMarkdown } from "./markdown-download";
import type { OutlineSection } from "./outline";
import { collectionHref } from "./routing";
import type {
  DraftComment,
  DraftDecision,
  DraftFeedback,
  Notice,
} from "./types";

interface DocumentReviewPageProps {
  documentSlug: string;
}

const COMPACT_FEEDBACK_BREAKPOINT = 760;

/** Select value that stands for the root, since a slug can never be empty. */
const ROOT_DESTINATION = "";

export function DocumentReviewPage({ documentSlug }: DocumentReviewPageProps) {
  const [currentDocument, setCurrentDocument] = useState<PenaDocument | null>(
    null,
  );
  const [documentEtag, setDocumentEtag] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [sections, setSections] = useState<OutlineSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(documentSlug !== null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPendingFeedbackOpen, setIsPendingFeedbackOpen] = useState(
    () => window.innerWidth > COMPACT_FEEDBACK_BREAKPOINT,
  );
  const [isArchiving, setIsArchiving] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [moveDestination, setMoveDestination] = useState(ROOT_DESTINATION);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [draftFeedback, setDraftFeedback] = useState<DraftFeedback[]>([]);
  const [feedbackInstruction, setFeedbackInstruction] = useState("");
  const [isInstructionComposerOpen, setIsInstructionComposerOpen] =
    useState(false);
  const [submittedDecisions, setSubmittedDecisions] = useState<
    Record<string, string>
  >({});
  const [notice, setNotice] = useState<Notice>(null);
  const hasFeedbackInstruction = feedbackInstruction.trim().length > 0;
  const hasPendingFeedback =
    draftFeedback.length > 0 || hasFeedbackInstruction;

  const loadDocument = useCallback(async () => {
    if (!documentSlug) {
      return;
    }

    setIsLoading(true);
    setNotice(null);

    try {
      const resource = await fetchDocument(documentSlug);

      if (!resource) {
        setCurrentDocument(null);
        setDocumentEtag(null);
        setSubmittedDecisions({});
        return;
      }

      const nextDocument = resource.document;
      const parsedDocument = parseDecisionDocument(nextDocument.content);
      const nextSubmittedDecisions =
        parsedDocument.decisions.length > 0
          ? readSubmittedDecisions(
              await fetchFeedback(documentSlug, resource.etag),
              parsedDocument.decisions,
            )
          : {};

      setCurrentDocument(nextDocument);
      setDocumentEtag(resource.etag);
      setSubmittedDecisions(nextSubmittedDecisions);
    } catch (error) {
      setCurrentDocument(null);
      setDocumentEtag(null);
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

  // The rail lists this document's own headings, so the outline is reported
  // back by the viewer that renders them rather than fetched.
  const handleOutlineChange = useCallback((nextSections: OutlineSection[]) => {
    setSections(nextSections);
  }, []);

  const handleActiveSectionChange = useCallback((sectionId: string | null) => {
    setActiveSectionId((current) => (current === sectionId ? current : sectionId));
  }, []);

  const handleHistoryError = useCallback((message: string) => {
    setNotice({ kind: "error", message });
  }, []);

  useEffect(() => {
    void fetchCollections()
      .then((response) => setCollections(response.collections ?? []))
      .catch(() => setCollections([]));
  }, []);

  useEffect(() => {
    if (documentSlug) {
      void loadDocument();
    }
  }, [documentSlug, loadDocument]);

  useEffect(() => {
    if (currentDocument) {
      window.document.title = `${currentDocument.title} · Pena`;
    } else if (documentSlug) {
      window.document.title = `${documentSlug} · Pena`;
    }
  }, [currentDocument, documentSlug]);

  // Claude republishes while the window sits in the background. Refetching on
  // focus replaces the manual refresh button, but never discards a draft.
  useEffect(() => {
    function handleFocus(): void {
      if (hasPendingFeedback) {
        return;
      }

      void loadDocument();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [hasPendingFeedback, loadDocument]);

  // Sending everything is the one action worth reaching without the mouse, and
  // it stays available while a comment is still focused.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (
        !isSubmitAllShortcut(event) ||
        !hasPendingFeedback ||
        isSubmitting
      ) {
        return;
      }

      event.preventDefault();
      void sendFeedback();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

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
    if (!documentSlug || !hasPendingFeedback) {
      return;
    }

    const submittedDrafts = draftFeedback;
    const submittedInstruction = feedbackInstruction;
    setIsSubmitting(true);
    setNotice(null);

    try {
      if (!documentEtag) {
        throw new Error("Reload the document before submitting feedback.");
      }

      await submitFeedback(
        documentSlug,
        {
          ...(submittedInstruction.trim().length === 0
            ? {}
            : { instruction: submittedInstruction }),
          comments: submittedDrafts.map(
            ({ selectedText, comment, contextBefore, contextAfter }) => ({
              selectedText,
              comment,
              contextBefore,
              contextAfter,
            }),
          ),
        },
        documentEtag,
      );
      const submittedIds = new Set(
        submittedDrafts.map((draft) => draft.id),
      );
      const submittedDecisionDrafts = submittedDrafts.filter(
        (draft): draft is DraftDecision => draft.kind === "decision",
      );

      setDraftFeedback((drafts) =>
        drafts.filter((draft) => !submittedIds.has(draft.id)),
      );
      setFeedbackInstruction((current) =>
        current === submittedInstruction ? "" : current,
      );
      setIsInstructionComposerOpen(false);
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
        message:
          submittedDrafts.length === 0
            ? "Instruction submitted. Ask Claude to read your Pena feedback."
            : `${formatFeedbackCount(submittedDrafts.length)}${
                submittedInstruction.trim().length > 0
                  ? " and an overall instruction"
                  : ""
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

  async function handleArchive(): Promise<void> {
    if (!documentSlug || !currentDocument || !documentEtag) {
      return;
    }

    if (hasPendingFeedback) {
      setNotice({
        kind: "error",
        message: "Submit or remove the draft feedback before archiving.",
      });
      return;
    }

    setIsArchiving(true);
    setNotice(null);

    try {
      await archiveDocument(documentSlug, documentEtag);
      window.location.assign(
        collectionHref(currentDocument?.collectionSlug ?? null),
      );
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

  function beginMove(): void {
    if (hasPendingFeedback) {
      setNotice({
        kind: "error",
        message: "Submit or remove the draft feedback before moving.",
      });
      return;
    }

    const firstDestination = moveDestinations[0];

    if (!firstDestination) {
      return;
    }

    setMoveDestination(firstDestination.value);
    setIsMoveOpen(true);
    setNotice(null);
  }

  function cancelMove(): void {
    setIsMoveOpen(false);
    setMoveDestination(ROOT_DESTINATION);
  }

  async function handleMove(): Promise<void> {
    if (!documentSlug || !currentDocument || !documentEtag) {
      return;
    }

    if (hasPendingFeedback) {
      setNotice({
        kind: "error",
        message: "Submit or remove the draft feedback before moving.",
      });
      return;
    }

    setIsMoving(true);
    setNotice(null);

    try {
      const destination =
        moveDestination === ROOT_DESTINATION ? null : moveDestination;
      const movedDocument = await moveDocument(
        documentSlug,
        destination,
        documentEtag,
      );
      // The URL does not change, so the page reloads its own state.
      setIsMoveOpen(false);
      setMoveDestination(ROOT_DESTINATION);
      await loadDocument();
      setNotice({
        kind: "success",
        message:
          movedDocument.collectionSlug === null
            ? "Moved to the root."
            : `Moved to ${
                formatCollectionPath(collections, movedDocument.collectionSlug) ||
                movedDocument.collectionSlug
              }.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not move the document.",
      });
    } finally {
      setIsMoving(false);
    }
  }

  const currentCollectionSlug = currentDocument?.collectionSlug ?? null;
  // Every collection except the current one, plus the root when the document
  // is not already there. Nested names are indented like a folder tree.
  const moveDestinations = [
    ...(currentCollectionSlug === null
      ? []
      : [{ value: ROOT_DESTINATION, label: "Root" }]),
    ...flattenCollectionTree(buildCollectionTree(collections))
      .filter(({ collection }) => collection.slug !== currentCollectionSlug)
      .map(({ collection, depth }) => ({
        value: collection.slug,
        label: `${"\u00a0\u00a0".repeat(depth)}${collection.name}`,
      })),
  ];
  const breadcrumbPath = collectionPath(collections, currentCollectionSlug);

  return (
    <PenaLayout
      activeSectionId={activeSectionId}
      sections={sections}
      collectionSlug={currentCollectionSlug}
    >
      <section
        className={`document-pane${
          draftFeedback.length > 0 && isPendingFeedbackOpen
            ? " has-pending-feedback"
            : ""
        }`}
        aria-label="Document"
      >
        <header className="document-meta">
          <div className="document-identity">
            <nav className="document-breadcrumb" aria-label="Breadcrumb">
              <a className="document-breadcrumb-collection" href="/">
                All documents
              </a>
              {breadcrumbPath.map((collection) => (
                <span
                  className="document-breadcrumb-step"
                  key={collection.slug}
                >
                  <span aria-hidden="true">/</span>
                  <a
                    className="document-breadcrumb-collection"
                    href={collectionHref(collection.slug)}
                  >
                    {collection.name}
                  </a>
                </span>
              ))}
              <span aria-hidden="true">/</span>
              <span
                className="document-breadcrumb-current"
                title={documentSlug}
              >
                {documentSlug}
              </span>
            </nav>
          </div>

          {currentDocument ? (
            <div className="document-utilities">
              <div className="document-version-meta">
                <time dateTime={currentDocument.updatedAt}>
                  {`Updated ${formatRelativeTime(currentDocument.updatedAt)}, ${formatClockTime(currentDocument.updatedAt)}`}
                </time>
                <button
                  className="document-version"
                  aria-label={`Version ${currentDocument.version}`}
                  type="button"
                  aria-expanded={isHistoryOpen}
                  onClick={() => setIsHistoryOpen((current) => !current)}
                >
                  v{currentDocument.version}
                </button>
                {currentDocument.archivedAt ? (
                  <span className="archived-document-label">Archived</span>
                ) : null}
              </div>

              <div className="document-actions">
                <button
                  className="download-document-button"
                  type="button"
                  onClick={() =>
                    downloadMarkdown(currentDocument.content, documentSlug)
                  }
                >
                  <DownloadIcon />
                  Download
                </button>
                {!currentDocument.archivedAt &&
                moveDestinations.length > 0 ? (
                  <button
                    className="move-document-button"
                    type="button"
                    onClick={beginMove}
                    disabled={isArchiving || isMoving}
                  >
                    <MoveIcon />
                    Move
                  </button>
                ) : null}
                {!currentDocument.archivedAt ? (
                  <button
                    className="archive-document-button"
                    type="button"
                    onClick={() => void handleArchive()}
                    disabled={isArchiving || isMoving}
                  >
                    <ArchiveIcon />
                    {isArchiving ? "Archiving" : "Archive"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </header>

        {isMoveOpen && currentDocument ? (
          <div
            className="move-document-panel"
            role="group"
            aria-label="Move document"
          >
            <div>
              <p className="move-document-title">Move this document</p>
              <p>Feedback and version history move with it.</p>
            </div>
            <label>
              <span>Destination collection</span>
              <select
                aria-label="Destination collection"
                value={moveDestination}
                onChange={(event) => setMoveDestination(event.target.value)}
                disabled={isMoving}
                autoFocus
              >
                {moveDestinations.map((destination) => (
                  <option value={destination.value} key={destination.value}>
                    {destination.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="move-document-actions">
              <button
                className="quiet-button"
                type="button"
                onClick={cancelMove}
                disabled={isMoving}
              >
                Cancel
              </button>
              <button
                className="confirm-move-button"
                type="button"
                onClick={() => void handleMove()}
                disabled={isMoving}
              >
                {isMoving ? "Moving" : "Move document"}
              </button>
            </div>
          </div>
        ) : null}

        {isLoading && !currentDocument ? (
          <div className="document-state" aria-live="polite">
            <span className="loading-line" />
            <span className="loading-line short" />
            <span className="loading-line" />
          </div>
        ) : currentDocument && documentEtag && isHistoryOpen ? (
          <VersionHistory
            currentDocument={currentDocument}
            currentEtag={documentEtag}
            canRestore={!hasPendingFeedback}
            onClose={() => setIsHistoryOpen(false)}
            onRestored={(resource) => {
              setCurrentDocument(resource.document);
              setDocumentEtag(resource.etag);
              setSubmittedDecisions({});
              setIsHistoryOpen(false);
              setNotice({
                kind: "success",
                message: `Version ${resource.document.version} is now current.`,
              });
            }}
            onError={handleHistoryError}
          />
        ) : currentDocument?.archivedAt ? (
          <div className="archived-document-view">
            <p className="archived-document-notice">
              This document is archived. Its content and version history remain
              available, but review and publishing are paused.
            </p>
            <ReadOnlyDocument
              title={currentDocument.title}
              content={currentDocument.content}
            />
          </div>
        ) : currentDocument ? (
          <DocumentViewer
            document={currentDocument}
            draftFeedback={draftFeedback}
            feedbackInstruction={feedbackInstruction}
            isInstructionComposerOpen={isInstructionComposerOpen}
            isPendingFeedbackOpen={isPendingFeedbackOpen}
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
            onFeedbackInstructionChange={(instruction) => {
              setFeedbackInstruction(instruction);
              setNotice(null);
            }}
            onInstructionComposerOpenChange={setIsInstructionComposerOpen}
            onPendingFeedbackOpenChange={setIsPendingFeedbackOpen}
            onSubmitFeedback={() => void sendFeedback()}
            onOutlineChange={handleOutlineChange}
            onActiveSectionChange={handleActiveSectionChange}
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

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5h11v8h-11z" />
      <path d="M2 2.5h12V5H2z" />
      <path d="M6 8h4" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5.5h7" />
      <path d="m7 2.5 3 3-3 3" />
      <path d="M13.5 10.5h-7" />
      <path d="m9 7.5-3 3 3 3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v7" />
      <path d="m5 7 3 3 3-3" />
      <path d="M3 12.5h10" />
    </svg>
  );
}
