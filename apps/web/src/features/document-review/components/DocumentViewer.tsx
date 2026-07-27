import {
  parseDecisionDocument,
  type DecisionBlock as DecisionBlockDefinition,
  type PenaDocument,
} from "@pena/contracts";
import {
  Fragment,
  memo,
  useLayoutEffect,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";

import { readElementPassage } from "../../../selection";
import { isCommentShortcut } from "../../../shortcuts";
import { MarkdownContent } from "../MarkdownContent";
import {
  readActiveSection,
  readOutlineSections,
  type OutlineSection,
} from "../outline";
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
import { createDraftDecision } from "../decision-feedback";
import { createAnnotatedMarkdownComponents } from "../markdown-components";
import type {
  DraftComment,
  DraftDecision,
  DraftFeedback,
  Notice,
} from "../types";
import { CommentComposer } from "./CommentComposer";
import { DecisionBlock } from "./DecisionBlock";
import { FeedbackBar } from "./FeedbackBar";

interface DocumentViewerProps {
  document: PenaDocument;
  draftFeedback: DraftFeedback[];
  submittedDecisions: Record<string, string>;
  isSubmitting: boolean;
  notice: Notice;
  onDraftSaved: (draft: DraftComment) => void;
  onDraftDeleted: (draftId: string) => void;
  onDecisionDraftChanged: (
    decisionId: string,
    draft: DraftDecision | null,
  ) => void;
  onNoticeClear: () => void;
  onSubmitFeedback: () => void;
  onOutlineChange: (sections: OutlineSection[]) => void;
  onActiveSectionChange: (sectionId: string | null) => void;
}

export function DocumentViewer({
  document: penaDocument,
  draftFeedback,
  submittedDecisions,
  isSubmitting,
  notice,
  onDraftSaved,
  onDraftDeleted,
  onDecisionDraftChanged,
  onNoticeClear,
  onSubmitFeedback,
  onOutlineChange,
  onActiveSectionChange,
}: DocumentViewerProps) {
  const documentSurfaceRef = useRef<HTMLElement>(null);
  const documentStageRef = useRef<HTMLDivElement>(null);
  const commentPopoverRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [editor, dispatch] = useReducer(
    commentEditorReducer,
    initialCommentEditorState,
  );
  const parsedDocument = useMemo(
    () => parseDecisionDocument(penaDocument.content),
    [penaDocument.content],
  );
  const draftComments = useMemo(
    () =>
      draftFeedback.filter(
        (draft): draft is DraftComment => draft.kind === "comment",
      ),
    [draftFeedback],
  );
  const draftDecisions = useMemo(
    () =>
      draftFeedback.filter(
        (draft): draft is DraftDecision => draft.kind === "decision",
      ),
    [draftFeedback],
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

  // Read the outline back off the rendered headings, so it lists exactly what
  // is on the page — including the headings inside decision blocks.
  useEffect(() => {
    const surface = documentSurfaceRef.current;
    onOutlineChange(surface ? readOutlineSections(surface) : []);
  }, [onOutlineChange, parsedDocument]);

  useEffect(() => {
    function trackActiveSection(): void {
      const surface = documentSurfaceRef.current;

      if (surface) {
        onActiveSectionChange(readActiveSection(surface));
      }
    }

    trackActiveSection();
    window.addEventListener("scroll", trackActiveSection, { passive: true });
    window.addEventListener("resize", trackActiveSection);

    return () => {
      window.removeEventListener("scroll", trackActiveSection);
      window.removeEventListener("resize", trackActiveSection);
    };
  }, [onActiveSectionChange, parsedDocument]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && editor.passage) {
        event.preventDefault();
        dispatch({ type: "closed" });
        return;
      }

      if (!isCommentShortcut(event)) {
        return;
      }

      const surface = documentSurfaceRef.current;
      const stage = documentStageRef.current;
      const selection =
        surface && stage ? readAnchoredSelection(surface, stage) : null;

      if (selection) {
        event.preventDefault();
        dispatch({ type: "selection-opened", selection });
        onNoticeClear();
      }
    }

    window.document.addEventListener("keydown", handleKeyDown);
    return () =>
      window.document.removeEventListener("keydown", handleKeyDown);
  }, [editor.passage, onNoticeClear]);

  useEffect(() => {
    if (!editor.passage) {
      return;
    }

    function handleOutsidePointerDown(event: PointerEvent): void {
      const target = event.target;

      if (
        target instanceof Node &&
        !commentPopoverRef.current?.contains(target) &&
        !(
          target instanceof Element &&
          target.closest("[data-pena-decision-control]")
        )
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
    const utilityBarBottom =
      window.document
        .querySelector<HTMLElement>(".utility-bar")
        ?.getBoundingClientRect().bottom ?? 0;
    const viewportPadding = 12;
    const minimumTop = utilityBarBottom + viewportPadding;
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

  function handleDocumentSelection(event: SyntheticEvent<HTMLElement>): void {
    if (
      event.target instanceof Element &&
      event.target.closest("[data-pena-decision-control]")
    ) {
      return;
    }

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
      kind: "comment",
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

  function chooseDecision(
    decision: DecisionBlockDefinition,
    choice: string,
    bodyElement: HTMLElement,
  ): void {
    const surface = documentSurfaceRef.current;

    if (!surface) {
      return;
    }

    const passage = readElementPassage(surface, bodyElement);

    if (!passage) {
      return;
    }

    const currentDraft = draftDecisions.find(
      (draft) => draft.decisionId === decision.id,
    );
    const nextDraft =
      currentDraft?.choice === choice
        ? null
        : createDraftDecision(
            decision,
            choice,
            passage.selectedText,
            passage.contextBefore,
            passage.contextAfter,
          );

    onDecisionDraftChanged(decision.id, nextDraft);
    onNoticeClear();
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
          {parsedDocument.segments.map((segment, index) => {
            const namespace = `segment-${index}`;

            if (segment.type === "markdown") {
              return (
                <MarkdownSegment
                  content={segment.content}
                  key={namespace}
                  namespace={namespace}
                />
              );
            }

            const draftChoice =
              draftDecisions.find(
                (draft) => draft.decisionId === segment.decision.id,
              )?.choice ?? null;

            return (
              <Fragment key={segment.decision.id}>
                <DecisionBlock
                  decision={segment.decision}
                  namespace={namespace}
                  draftChoice={draftChoice}
                  submittedChoice={
                    submittedDecisions[segment.decision.id] ?? null
                  }
                  isSubmitting={isSubmitting}
                  position={
                    parsedDocument.decisions.findIndex(
                      (decision) => decision.id === segment.decision.id,
                    ) + 1
                  }
                  total={parsedDocument.decisions.length}
                  onChoice={chooseDecision}
                />
              </Fragment>
            );
          })}
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
          commentCount={draftComments.length}
          decisionCount={draftDecisions.length}
          isSubmitting={isSubmitting}
          notice={notice}
          onSubmit={onSubmitFeedback}
        />
      ) : null}
    </>
  );
}

interface MarkdownSegmentProps {
  content: string;
  namespace: string;
}

const MarkdownSegment = memo(function MarkdownSegment({
  content,
  namespace,
}: MarkdownSegmentProps) {
  const components = useMemo(
    () => createAnnotatedMarkdownComponents(namespace),
    [namespace],
  );

  return (
    <MarkdownContent components={components}>
      {content}
    </MarkdownContent>
  );
});
