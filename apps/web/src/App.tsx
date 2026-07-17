import {
  DocumentSlugSchema,
  type CommentInput,
  type PenaDocument,
} from "@pena/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { fetchDocument, submitFeedback } from "./api";
import {
  findTextRange,
  readSelection,
  readTextOffset,
  type SelectedPassage,
} from "./selection";

const DOCUMENT_ANCHOR_ID = "__pena-document__";

interface DraftComment extends CommentInput {
  id: string;
  anchorId: string;
  anchorOffset: number;
}

interface SelectionPosition {
  top: number;
  left: number;
}

interface DraftPosition {
  marker: SelectionPosition;
}

type Notice =
  | { kind: "error"; message: string }
  | { kind: "success"; message: string }
  | null;

export function App() {
  const documentSlug = readDocumentSlug(window.location.pathname);
  const documentSurfaceRef = useRef<HTMLElement>(null);
  const documentStageRef = useRef<HTMLDivElement>(null);
  const commentPopoverRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [currentDocument, setCurrentDocument] = useState<PenaDocument | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(documentSlug !== null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPassage, setSelectedPassage] =
    useState<SelectedPassage | null>(null);
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>(null);
  const [selectedAnchorOffset, setSelectedAnchorOffset] = useState<
    number | null
  >(null);
  const [selectionPosition, setSelectionPosition] =
    useState<SelectionPosition | null>(null);
  const [commentText, setCommentText] = useState("");
  const [draftComments, setDraftComments] = useState<DraftComment[]>([]);
  const [draftPositions, setDraftPositions] = useState<
    Record<string, DraftPosition>
  >({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const loadDocument = useCallback(async () => {
    if (!documentSlug) {
      return;
    }

    setIsLoading(true);
    setNotice(null);

    try {
      const penaDocument = await fetchDocument(documentSlug);
      setCurrentDocument(penaDocument);
      setSelectedPassage(null);
      setSelectedAnchorId(null);
      setSelectedAnchorOffset(null);
      setSelectionPosition(null);
      setEditingCommentId(null);
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
      document.title = `${documentSlug} · Pena`;
      void loadDocument();
    }
  }, [documentSlug, loadDocument]);

  useEffect(() => {
    const styleElement = document.createElement("style");
    styleElement.textContent = draftHighlightStyles;
    document.head.append(styleElement);

    return () => styleElement.remove();
  }, []);

  useEffect(() => {
    if (editingCommentId) {
      commentInputRef.current?.focus();
    }
  }, [editingCommentId]);

  useEffect(() => {
    if (!selectedPassage) {
      return;
    }

    function handleOutsidePointerDown(event: PointerEvent): void {
      const target = event.target;

      if (
        target instanceof Node &&
        !commentPopoverRef.current?.contains(target)
      ) {
        cancelComment();
      }
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [selectedPassage]);

  useLayoutEffect(() => {
    const popover = commentPopoverRef.current;

    if (!selectedPassage || !selectionPosition || !popover) {
      return;
    }

    const popoverRect = popover.getBoundingClientRect();
    const topbarBottom =
      document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect()
        .bottom ?? 0;
    const viewportPadding = 12;
    const minimumTop = topbarBottom + viewportPadding;
    const maximumTop = Math.max(
      minimumTop,
      window.innerHeight - popoverRect.height - viewportPadding,
    );
    const nextViewportTop = Math.max(
      minimumTop,
      Math.min(popoverRect.top, maximumTop),
    );
    const topAdjustment = nextViewportTop - popoverRect.top;

    if (Math.abs(topAdjustment) >= 0.5) {
      setSelectionPosition((position) =>
        position
          ? {
              ...position,
              top: position.top + topAdjustment,
            }
          : position,
      );
    }
  }, [selectedPassage, selectionPosition]);

  useEffect(() => {
    if (
      !selectedPassage ||
      !selectedAnchorId ||
      selectedAnchorOffset === null
    ) {
      return;
    }

    const anchorId = selectedAnchorId;
    const anchorOffset = selectedAnchorOffset;
    const selectedText = selectedPassage.selectedText;

    function updateSelectionPosition(): void {
      const surface = documentSurfaceRef.current;
      const anchor = surface
        ? resolveAnnotationAnchor(surface, anchorId)
        : null;
      const range = anchor
        ? findTextRange(anchor, selectedText, anchorOffset)
        : null;

      if (range) {
        setSelectionPosition(
          readSelectionPosition(range, documentStageRef.current),
        );
      }
    }

    window.addEventListener("resize", updateSelectionPosition);
    return () => window.removeEventListener("resize", updateSelectionPosition);
  }, [selectedAnchorId, selectedAnchorOffset, selectedPassage]);

  useEffect(() => {
    if (!("highlights" in CSS) || typeof Highlight === "undefined") {
      return;
    }

    const surface = documentSurfaceRef.current;

    if (!surface) {
      return;
    }

    const ranges = draftComments.flatMap((draft) => {
      const anchor = resolveAnnotationAnchor(surface, draft.anchorId);
      const range = anchor
        ? findTextRange(anchor, draft.selectedText, draft.anchorOffset)
        : null;
      return range ? [range] : [];
    });

    CSS.highlights.set(
      "pena-draft-comments",
      new Highlight(...ranges),
    );

    return () => {
      CSS.highlights.delete("pena-draft-comments");
    };
  }, [currentDocument, draftComments]);

  useLayoutEffect(() => {
    const surface = documentSurfaceRef.current;
    const stage = documentStageRef.current;

    if (!surface || !stage) {
      return;
    }

    const surfaceElement = surface;
    const stageElement = stage;

    function updateDraftPositions(): void {
      const nextPositions: Record<string, DraftPosition> = {};

      for (const draft of draftComments) {
        const anchor = resolveAnnotationAnchor(
          surfaceElement,
          draft.anchorId,
        );
        const range = anchor
          ? findTextRange(anchor, draft.selectedText, draft.anchorOffset)
          : null;
        const marker = range ? readMarkerPosition(range, stageElement) : null;

        if (marker) {
          nextPositions[draft.id] = { marker };
        }
      }

      setDraftPositions((currentPositions) =>
        haveSameDraftPositions(currentPositions, nextPositions)
          ? currentPositions
          : nextPositions,
      );
    }

    updateDraftPositions();

    const resizeObserver = new ResizeObserver(updateDraftPositions);
    resizeObserver.observe(surfaceElement);
    window.addEventListener("resize", updateDraftPositions);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDraftPositions);
    };
  }, [currentDocument, draftComments]);

  function handleDocumentSelection(): void {
    const surface = documentSurfaceRef.current;
    const selection = window.getSelection();

    if (!surface) {
      return;
    }

    const passage = readSelection(surface, selection);

    if (passage && selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      const anchorElement =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      const endAnchorElement =
        range.endContainer.nodeType === Node.ELEMENT_NODE
          ? (range.endContainer as Element)
          : range.endContainer.parentElement;
      const startAnchor = anchorElement?.closest<HTMLElement>(
        "[data-annotation-block]",
      );
      const endAnchor = endAnchorElement?.closest<HTMLElement>(
        "[data-annotation-block]",
      );
      const anchor =
        startAnchor && startAnchor === endAnchor ? startAnchor : surface;
      const anchorId =
        anchor === surface
          ? DOCUMENT_ANCHOR_ID
          : anchor.dataset.annotationBlock;
      const anchorOffset = anchor
        ? readTextOffset(anchor, range, passage.selectedText)
        : null;

      if (!anchorId || anchorOffset === null) {
        return;
      }

      setEditingCommentId(null);
      setSelectedAnchorId(anchorId);
      setSelectedAnchorOffset(anchorOffset);
      setSelectionPosition(readSelectionPosition(range, documentStageRef.current));
      setSelectedPassage(passage);
      setCommentText("");
      setNotice(null);
    }
  }

  function findDraftCommentAtPoint(
    clientX: number,
    clientY: number,
  ): DraftComment | null {
    const surface = documentSurfaceRef.current;

    if (!surface) {
      return null;
    }

    for (const draft of [...draftComments].reverse()) {
      const anchor = resolveAnnotationAnchor(surface, draft.anchorId);
      const range = anchor
        ? findTextRange(anchor, draft.selectedText, draft.anchorOffset)
        : null;

      if (
        range &&
        Array.from(range.getClientRects()).some(
          (rect) =>
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom,
        )
      ) {
        return draft;
      }
    }

    return null;
  }

  function handleDocumentClick(event: ReactMouseEvent<HTMLElement>): void {
    const selection = window.getSelection();

    if (selectedPassage || (selection && !selection.isCollapsed)) {
      return;
    }

    const draft = findDraftCommentAtPoint(event.clientX, event.clientY);

    if (draft) {
      event.preventDefault();
      editComment(draft);
    }
  }

  function handleDocumentMouseMove(
    event: ReactMouseEvent<HTMLElement>,
  ): void {
    event.currentTarget.style.cursor =
      !selectedPassage &&
      findDraftCommentAtPoint(event.clientX, event.clientY)
        ? "pointer"
        : "";
  }

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

  function addComment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (
      !selectedPassage ||
      !selectedAnchorId ||
      selectedAnchorOffset === null ||
      !commentText.trim()
    ) {
      return;
    }

    const nextComment = {
      ...selectedPassage,
      anchorId: selectedAnchorId,
      anchorOffset: selectedAnchorOffset,
      comment: commentText.trim(),
    };
    const commentId = editingCommentId ?? crypto.randomUUID();

    setDraftComments((comments) =>
      editingCommentId
        ? comments.map((comment) =>
            comment.id === editingCommentId
              ? { ...comment, ...nextComment }
              : comment,
          )
        : [
            ...comments,
            {
              id: commentId,
              ...nextComment,
            },
          ],
    );
    setEditingCommentId(null);
    setSelectedAnchorId(null);
    setSelectedAnchorOffset(null);
    setSelectionPosition(null);
    setSelectedPassage(null);
    setCommentText("");
    window.getSelection()?.removeAllRanges();
  }

  function editComment(draft: DraftComment): void {
    const surface = documentSurfaceRef.current;
    const anchor = surface
      ? resolveAnnotationAnchor(surface, draft.anchorId)
      : null;
    const range = anchor
      ? findTextRange(anchor, draft.selectedText, draft.anchorOffset)
      : null;

    setEditingCommentId(draft.id);
    setSelectedAnchorId(draft.anchorId);
    setSelectedAnchorOffset(draft.anchorOffset);
    setSelectionPosition(
      range ? readSelectionPosition(range, documentStageRef.current) : null,
    );
    setSelectedPassage({
      selectedText: draft.selectedText,
      contextBefore: draft.contextBefore,
      contextAfter: draft.contextAfter,
    });
    setCommentText(draft.comment);
    setNotice(null);
  }

  function cancelComment(): void {
    setEditingCommentId(null);
    setSelectedAnchorId(null);
    setSelectedAnchorOffset(null);
    setSelectionPosition(null);
    setSelectedPassage(null);
    setCommentText("");
  }

  function deleteEditingComment(): void {
    if (!editingCommentId) {
      return;
    }

    setDraftComments((comments) =>
      comments.filter((comment) => comment.id !== editingCommentId),
    );
    cancelComment();
  }

  async function sendFeedback(): Promise<void> {
    if (draftComments.length === 0 || editingCommentId) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      if (!documentSlug) {
        return;
      }

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
        message: `${submittedCount} ${submittedCount === 1 ? "comment" : "comments"} submitted. Ask Claude to read your Pena feedback.`,
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
            <div className="document-state empty-state">
              <span className="empty-glyph" aria-hidden="true">
                /
              </span>
              <h2>Document slug required</h2>
              <p>
                Open a direct URL such as <code>/documents/my-document</code>.
              </p>
            </div>
          ) : isLoading ? (
            <div className="document-state" aria-live="polite">
              <span className="loading-line" />
              <span className="loading-line short" />
              <span className="loading-line" />
            </div>
          ) : currentDocument ? (
            <div className="document-stage" ref={documentStageRef}>
              <article
                className="markdown-body"
                ref={documentSurfaceRef}
                onMouseUp={handleDocumentSelection}
                onKeyUp={handleDocumentSelection}
                onClick={handleDocumentClick}
                onMouseMove={handleDocumentMouseMove}
                onMouseLeave={(event) => {
                  event.currentTarget.style.cursor = "";
                }}
              >
                <ReactMarkdown
                  components={annotatedMarkdownComponents}
                  remarkPlugins={[remarkGfm]}
                >
                  {currentDocument.content}
                </ReactMarkdown>
              </article>

              {draftComments.map((draft, index) => {
                const position = draftPositions[draft.id];

                if (!position) {
                  return null;
                }

                return (
                  <div
                    className="comment-footnote"
                    data-pena-annotation
                    key={draft.id}
                    style={{
                      top: position.marker.top,
                      left: position.marker.left,
                    }}
                  >
                    <button
                      className="comment-marker"
                      type="button"
                      aria-label={`Edit comment ${index + 1}`}
                      title={draft.comment}
                      onClick={() => editComment(draft)}
                    >
                      {(index + 1).toString().padStart(2, "0")}
                    </button>
                  </div>
                );
              })}

              {selectedPassage && selectionPosition ? (
                <div
                  className="selection-comment-popover"
                  data-pena-annotation
                  ref={commentPopoverRef}
                  style={{
                    top: selectionPosition.top,
                    left: selectionPosition.left,
                  }}
                >
                  <CommentComposer
                    passage={selectedPassage}
                    isEditing={editingCommentId !== null}
                    commentText={commentText}
                    commentInputRef={commentInputRef}
                    onCommentChange={setCommentText}
                    onSubmit={addComment}
                    onCancel={cancelComment}
                    onDelete={
                      editingCommentId ? deleteEditingComment : undefined
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="document-state empty-state">
              <span className="empty-glyph" aria-hidden="true">
                ¶
              </span>
              <h2>No document published yet</h2>
              <p>
                Ask Claude to publish Markdown using the <strong>{documentSlug}</strong>{" "}
                slug, then refresh this page.
              </p>
            </div>
          )}

          {currentDocument && !selectedPassage ? (
            <footer className="feedback-bar" aria-label="Draft feedback">
              <div className="feedback-summary">
                <span className="comment-count" aria-label="Draft comment count">
                  {draftComments.length.toString().padStart(2, "0")}
                </span>
                <div>
                  <p className="section-label">Draft feedback</p>
                  {notice ? (
                    <p className={`notice ${notice.kind}`} role="status">
                      {notice.message}
                    </p>
                  ) : (
                    <p className="feedback-hint">
                      {draftComments.length === 0
                        ? "Select text in the document to start."
                        : `${draftComments.length} ${
                            draftComments.length === 1 ? "comment" : "comments"
                          } ready to submit.`}
                    </p>
                  )}
                </div>
              </div>
              <button
                className="submit-button"
                type="button"
                disabled={
                  draftComments.length === 0 ||
                  isSubmitting ||
                  editingCommentId !== null
                }
                onClick={() => void sendFeedback()}
              >
                <span>{isSubmitting ? "Submitting" : "Submit feedback"}</span>
                <ArrowIcon />
              </button>
            </footer>
          ) : null}
        </section>
      </main>
    </div>
  );
}

interface CommentComposerProps {
  passage: SelectedPassage;
  isEditing: boolean;
  commentText: string;
  commentInputRef: RefObject<HTMLTextAreaElement | null>;
  onCommentChange: (comment: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function CommentComposer({
  passage,
  isEditing,
  commentText,
  commentInputRef,
  onCommentChange,
  onSubmit,
  onCancel,
  onDelete,
}: CommentComposerProps) {
  return (
    <div className="inline-comment-composer">
      <form onSubmit={onSubmit}>
        <p className="annotation-label">
          {isEditing ? "Edit comment" : "New comment"}
        </p>
        <blockquote>{passage.selectedText}</blockquote>
        <label htmlFor="comment">
          {isEditing ? "Update your note" : "Your comment"}
        </label>
        <textarea
          id="comment"
          ref={commentInputRef}
          value={commentText}
          onChange={(event) => onCommentChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="What should change?"
          rows={3}
        />
        <div className="composer-actions">
          {isEditing && onDelete ? (
            <button
              className="delete-comment-button"
              type="button"
              onClick={onDelete}
            >
              Delete comment
            </button>
          ) : null}
          <button
            className="quiet-button"
            type="button"
            onClick={onCancel}
          >
            {isEditing ? "Cancel edit" : "Cancel"}
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!commentText.trim()}
          >
            {isEditing ? "Save comment" : "Add comment"}
          </button>
        </div>
      </form>
    </div>
  );
}

const annotatedMarkdownComponents: Components = {
  p: ({ node, ...props }) => (
    <p data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  h1: ({ node, ...props }) => (
    <h1 data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  h2: ({ node, ...props }) => (
    <h2 data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  h3: ({ node, ...props }) => (
    <h3 data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  h4: ({ node, ...props }) => (
    <h4 data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  ul: ({ node, ...props }) => (
    <ul data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  li: ({ node, ...props }) => (
    <li data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote
      data-annotation-block={readAnnotationBlockId(node)}
      {...props}
    />
  ),
  pre: ({ node, ...props }) => (
    <pre data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  table: ({ node, ...props }) => (
    <table data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  th: ({ node, ...props }) => (
    <th data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  td: ({ node, ...props }) => (
    <td data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
};

const draftHighlightStyles = `
  ::highlight(pena-draft-comments) {
    background: rgb(217 164 65 / 20%);
    text-decoration: underline;
    text-decoration-color: rgb(237 187 91 / 70%);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
`;

const COMMENT_POPOVER_WIDTH = 360;
const COMMENT_POPOVER_GAP = 10;
const COMMENT_MARKER_SIZE = 20;
const COMMENT_MARKER_GAP = 4;

function readSelectionPosition(
  range: Range,
  stage: HTMLElement | null,
): SelectionPosition | null {
  if (!stage) {
    return null;
  }

  const stageRect = stage.getBoundingClientRect();
  const anchorRect = readRangeAnchorRect(range);
  const popoverWidth = Math.min(COMMENT_POPOVER_WIDTH, stageRect.width);
  const positionToRight =
    anchorRect.right - stageRect.left + COMMENT_POPOVER_GAP;
  const fitsToRight =
    positionToRight + popoverWidth <= stageRect.width;
  const left = fitsToRight
    ? positionToRight
    : Math.max(
        0,
        Math.min(
          anchorRect.left - stageRect.left,
          stageRect.width - popoverWidth,
        ),
      );

  return {
    top:
      (fitsToRight ? anchorRect.top : anchorRect.bottom) -
      stageRect.top +
      (fitsToRight ? 0 : COMMENT_POPOVER_GAP),
    left,
  };
}

function readMarkerPosition(
  range: Range,
  stage: HTMLElement | null,
): SelectionPosition | null {
  if (!stage) {
    return null;
  }

  const stageRect = stage.getBoundingClientRect();
  const anchorRect = readRangeAnchorRect(range);
  const positionToRight =
    anchorRect.right - stageRect.left + COMMENT_MARKER_GAP;
  const fitsToRight =
    positionToRight + COMMENT_MARKER_SIZE <= stageRect.width;
  const positionAbove =
    anchorRect.top -
    stageRect.top -
    COMMENT_MARKER_SIZE +
    COMMENT_MARKER_GAP;

  return {
    top:
      positionAbove >= 0
        ? positionAbove
        : anchorRect.bottom - stageRect.top + COMMENT_MARKER_GAP,
    left: fitsToRight
      ? positionToRight
      : Math.max(
          0,
          Math.min(
            anchorRect.right - stageRect.left - COMMENT_MARKER_SIZE,
            stageRect.width - COMMENT_MARKER_SIZE,
          ),
        ),
  };
}

function readRangeAnchorRect(range: Range): DOMRect {
  return (
    Array.from(range.getClientRects()).at(-1) ?? range.getBoundingClientRect()
  );
}

function haveSameDraftPositions(
  currentPositions: Record<string, DraftPosition>,
  nextPositions: Record<string, DraftPosition>,
): boolean {
  const currentKeys = Object.keys(currentPositions);
  const nextKeys = Object.keys(nextPositions);

  return (
    currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => {
      const current = currentPositions[key];
      const next = nextPositions[key];

      return (
        current !== undefined &&
        next !== undefined &&
        Math.abs(current.marker.top - next.marker.top) < 0.5 &&
        Math.abs(current.marker.left - next.marker.left) < 0.5
      );
    })
  );
}

function resolveAnnotationAnchor(
  surface: HTMLElement,
  anchorId: string,
): HTMLElement | null {
  if (anchorId === DOCUMENT_ANCHOR_ID) {
    return surface;
  }

  return surface.querySelector<HTMLElement>(
    `[data-annotation-block="${CSS.escape(anchorId)}"]`,
  );
}

function readAnnotationBlockId(
  node:
    | {
        position?: {
          start?: {
            offset?: number;
            line?: number;
            column?: number;
          };
        };
      }
    | undefined,
): string {
  const start = node?.position?.start;
  return `block-${start?.offset ?? `${start?.line ?? 0}-${start?.column ?? 0}`}`;
}

function readDocumentSlug(pathname: string): string | null {
  const match = /^\/documents\/([^/]+)\/?$/.exec(pathname);

  if (!match?.[1]) {
    return null;
  }

  try {
    const parsedSlug = DocumentSlugSchema.safeParse(
      decodeURIComponent(match[1]),
    );
    return parsedSlug.success ? parsedSlug.data : null;
  } catch {
    return null;
  }
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

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}
