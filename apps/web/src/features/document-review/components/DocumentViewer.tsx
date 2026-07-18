import type { PenaDocument } from "@pena/contracts";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  findDraftCommentAtPoint,
  findDraftRange,
  readAnchoredSelection,
  readSelectionPosition,
} from "../annotation";
import {
  subscribeToSelectionPosition,
  useDraftHighlights,
  useDraftPositions,
} from "../annotation-layout";
import {
  commentEditorReducer,
  initialCommentEditorState,
} from "../editor-state";
import { annotatedMarkdownComponents } from "../markdown-components";
import type { DraftComment, Notice } from "../types";
import { CommentComposer } from "./CommentComposer";
import { FeedbackBar } from "./FeedbackBar";

interface DocumentViewerProps {
  document: PenaDocument;
  draftComments: DraftComment[];
  isSubmitting: boolean;
  notice: Notice;
  onDraftSaved: (draft: DraftComment) => void;
  onDraftDeleted: (draftId: string) => void;
  onNoticeClear: () => void;
  onSubmitFeedback: () => void;
}

export function DocumentViewer({
  document: penaDocument,
  draftComments,
  isSubmitting,
  notice,
  onDraftSaved,
  onDraftDeleted,
  onNoticeClear,
  onSubmitFeedback,
}: DocumentViewerProps) {
  const documentSurfaceRef = useRef<HTMLElement>(null);
  const documentStageRef = useRef<HTMLDivElement>(null);
  const commentPopoverRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [editor, dispatch] = useReducer(
    commentEditorReducer,
    initialCommentEditorState,
  );
  const draftPositions = useDraftPositions(
    documentSurfaceRef,
    documentStageRef,
    penaDocument.content,
    draftComments,
  );

  useDraftHighlights(
    documentSurfaceRef,
    penaDocument.content,
    draftComments,
  );

  useEffect(() => {
    if (editor.editingCommentId) {
      commentInputRef.current?.focus();
    }
  }, [editor.editingCommentId]);

  useEffect(() => {
    if (!editor.passage) {
      return;
    }

    function handleOutsidePointerDown(event: PointerEvent): void {
      const target = event.target;

      if (
        target instanceof Node &&
        !commentPopoverRef.current?.contains(target)
      ) {
        dispatch({ type: "closed" });
      }
    }

    window.document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () =>
      window.document.removeEventListener(
        "pointerdown",
        handleOutsidePointerDown,
      );
  }, [editor.passage]);

  useLayoutEffect(() => {
    const popover = commentPopoverRef.current;

    if (!editor.passage || !editor.position || !popover) {
      return;
    }

    const popoverRect = popover.getBoundingClientRect();
    const topbarBottom =
      window.document
        .querySelector<HTMLElement>(".topbar")
        ?.getBoundingClientRect().bottom ?? 0;
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
      dispatch({
        type: "position-changed",
        position: {
          ...editor.position,
          top: editor.position.top + topAdjustment,
        },
      });
    }
  }, [editor.passage, editor.position]);

  useEffect(() => {
    const surface = documentSurfaceRef.current;
    const stage = documentStageRef.current;

    if (
      !surface ||
      !stage ||
      !editor.passage ||
      !editor.anchorId ||
      editor.anchorOffset === null
    ) {
      return;
    }

    return subscribeToSelectionPosition(
      surface,
      editor.anchorId,
      editor.anchorOffset,
      editor.passage.selectedText,
      (range) => {
        const position = readSelectionPosition(range, stage);

        if (position) {
          dispatch({ type: "position-changed", position });
        }
      },
    );
  }, [
    editor.anchorId,
    editor.anchorOffset,
    editor.passage,
    penaDocument.content,
  ]);

  function handleDocumentSelection(): void {
    const surface = documentSurfaceRef.current;
    const stage = documentStageRef.current;

    if (!surface || !stage) {
      return;
    }

    const selection = readAnchoredSelection(surface, stage);

    if (selection) {
      dispatch({ type: "selection-opened", selection });
      onNoticeClear();
    }
  }

  function handleDocumentClick(event: ReactMouseEvent<HTMLElement>): void {
    const selection = window.getSelection();

    if (editor.passage || (selection && !selection.isCollapsed)) {
      return;
    }

    const draft = findDraftAtPoint(event.clientX, event.clientY);

    if (draft) {
      event.preventDefault();
      openDraftForEditing(draft);
    }
  }

  function handleDocumentMouseMove(
    event: ReactMouseEvent<HTMLElement>,
  ): void {
    event.currentTarget.style.cursor =
      !editor.passage && findDraftAtPoint(event.clientX, event.clientY)
        ? "pointer"
        : "";
  }

  function findDraftAtPoint(
    clientX: number,
    clientY: number,
  ): DraftComment | null {
    const surface = documentSurfaceRef.current;
    return surface
      ? findDraftCommentAtPoint(
          surface,
          draftComments,
          clientX,
          clientY,
        )
      : null;
  }

  function openDraftForEditing(draft: DraftComment): void {
    const surface = documentSurfaceRef.current;
    const range = surface ? findDraftRange(surface, draft) : null;

    dispatch({
      type: "comment-edit-opened",
      draft,
      position: range
        ? readSelectionPosition(range, documentStageRef.current)
        : null,
    });
    onNoticeClear();
  }

  function saveComment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (
      !editor.passage ||
      !editor.anchorId ||
      editor.anchorOffset === null ||
      !editor.text.trim()
    ) {
      return;
    }

    onDraftSaved({
      id: editor.editingCommentId ?? crypto.randomUUID(),
      ...editor.passage,
      anchorId: editor.anchorId,
      anchorOffset: editor.anchorOffset,
      comment: editor.text.trim(),
    });
    dispatch({ type: "closed" });
    window.getSelection()?.removeAllRanges();
  }

  function deleteEditingComment(): void {
    if (!editor.editingCommentId) {
      return;
    }

    onDraftDeleted(editor.editingCommentId);
    dispatch({ type: "closed" });
  }

  return (
    <>
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
            {penaDocument.content}
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
                onClick={() => openDraftForEditing(draft)}
              >
                {(index + 1).toString().padStart(2, "0")}
              </button>
            </div>
          );
        })}

        {editor.passage && editor.position ? (
          <div
            className="selection-comment-popover"
            data-pena-annotation
            ref={commentPopoverRef}
            style={{
              top: editor.position.top,
              left: editor.position.left,
            }}
          >
            <CommentComposer
              passage={editor.passage}
              isEditing={editor.editingCommentId !== null}
              commentText={editor.text}
              commentInputRef={commentInputRef}
              onCommentChange={(text) =>
                dispatch({ type: "text-changed", text })
              }
              onSubmit={saveComment}
              onCancel={() => dispatch({ type: "closed" })}
              onDelete={
                editor.editingCommentId ? deleteEditingComment : undefined
              }
            />
          </div>
        ) : null}
      </div>

      {!editor.passage ? (
        <FeedbackBar
          draftCount={draftComments.length}
          isSubmitting={isSubmitting}
          notice={notice}
          onSubmit={onSubmitFeedback}
        />
      ) : null}
    </>
  );
}
