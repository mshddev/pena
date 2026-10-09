import {
  parseDecisionDocument,
  type DecisionBlock as DecisionBlockDefinition,
  type ParsedDecisionDocument,
  type PenaDocument,
} from "@pena/contracts";
import {
  Fragment,
  memo,
  useCallback,
  useLayoutEffect,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";

import { readElementPassage } from "../../../selection";
import { isCommentShortcut } from "../../../shortcuts";
import { MarkdownContent } from "../MarkdownContent";
import {
  findOutlineHeading,
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
import { readTopBarBottom, toViewportRect } from "../frame-geometry";
import { scrollToReadingPosition } from "../html-frame";
import { createAnnotatedMarkdownComponents } from "../markdown-components";
import type {
  DraftComment,
  DraftDecision,
  DraftFeedback,
  Notice,
} from "../types";
import { CommentComposer } from "./CommentComposer";
import { DecisionBlock } from "./DecisionBlock";
import { DocumentPageTitle } from "./DocumentPageTitle";
import { FeedbackBar } from "./FeedbackBar";
import { HtmlDocumentFrame } from "./HtmlDocumentFrame";
import { PendingFeedbackPanel } from "./PendingFeedbackPanel";

/** An HTML page carries no decision blocks. */
const PAGE_WITHOUT_DECISIONS: ParsedDecisionDocument = {
  segments: [],
  decisions: [],
};

type PointerPosition = Pick<MouseEvent, "clientX" | "clientY" | "preventDefault">;

/** What the frame's listeners call, refreshed every render. */
interface FrameEventHandlers {
  select: () => void;
  click: (event: PointerPosition) => void;
  move: (event: PointerPosition) => void;
  pointerDown: () => void;
}

interface DocumentViewerProps {
  document: PenaDocument;
  draftFeedback: DraftFeedback[];
  feedbackInstruction: string;
  isInstructionComposerOpen: boolean;
  isPendingFeedbackOpen: boolean;
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
  onFeedbackInstructionChange: (instruction: string) => void;
  onInstructionComposerOpenChange: (isOpen: boolean) => void;
  onPendingFeedbackOpenChange: (isOpen: boolean) => void;
  onSubmitFeedback: () => void;
  isFeedbackMinimized?: boolean;
  onFeedbackMinimizedChange?: (isMinimized: boolean) => void;
  onOutlineChange: (sections: OutlineSection[]) => void;
  onActiveSectionChange: (sectionId: string | null) => void;
}

export function DocumentViewer({
  document: penaDocument,
  draftFeedback,
  feedbackInstruction,
  isInstructionComposerOpen,
  isPendingFeedbackOpen,
  submittedDecisions,
  isSubmitting,
  notice,
  onDraftSaved,
  onDraftDeleted,
  onDecisionDraftChanged,
  onNoticeClear,
  onFeedbackInstructionChange,
  onInstructionComposerOpenChange,
  onPendingFeedbackOpenChange,
  onSubmitFeedback,
  isFeedbackMinimized,
  onFeedbackMinimizedChange,
  onOutlineChange,
  onActiveSectionChange,
}: DocumentViewerProps) {
  const documentSurfaceRef = useRef<HTMLElement>(null);
  const documentStageRef = useRef<HTMLDivElement>(null);
  const commentPopoverRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const pendingFeedbackPanelRef = useRef<HTMLElement>(null);
  const didRestoreLocationHashRef = useRef(false);
  const frameEventsRef = useRef<FrameEventHandlers | null>(null);
  const [editor, dispatch] = useReducer(
    commentEditorReducer,
    initialCommentEditorState,
  );
  const isHtml = penaDocument.format === "html";
  // An HTML page is reviewed inside its frame: the surface is the frame's
  // body once it loads, and it changes with every load.
  const [frameSurface, setFrameSurface] = useState<HTMLElement | null>(null);
  const pageSurface = isHtml ? frameSurface : null;
  const surfaceKey = isHtml ? frameSurface : penaDocument.content;
  const parsedDocument = useMemo(
    () =>
      isHtml
        ? PAGE_WITHOUT_DECISIONS
        : parseDecisionDocument(penaDocument.content),
    [isHtml, penaDocument.content],
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
  const isPendingPanelVisible =
    isPendingFeedbackOpen && draftFeedback.length > 0;
  const draftPositions = useDraftPositions(
    documentSurfaceRef,
    documentStageRef,
    surfaceKey,
    draftComments,
  );

  useDraftHighlights(documentSurfaceRef, surfaceKey, draftComments);

  const handleFrameLoad = useCallback((frameDocument: Document) => {
    documentSurfaceRef.current = frameDocument.body;
    setFrameSurface(frameDocument.body);
  }, []);

  useEffect(() => {
    if (!isHtml) {
      setFrameSurface(null);
    }
  }, [isHtml]);

  useEffect(() => {
    if (editor.editingCommentId) {
      commentInputRef.current?.focus();
    }
  }, [editor.editingCommentId]);

  // Read the outline back off the rendered headings, so it lists exactly what
  // is on the page — including the headings inside decision blocks.
  useLayoutEffect(() => {
    const stage = documentStageRef.current;
    const nextSections = stage
      ? readOutlineSections(stage, pageSurface)
      : [];

    onOutlineChange(nextSections);

    // An HTML page's headings only exist once its frame has loaded.
    if (didRestoreLocationHashRef.current || (isHtml && !pageSurface)) {
      return;
    }

    didRestoreLocationHashRef.current = true;

    const sectionId = readLocationHash();
    const target = sectionId
      ? window.document.getElementById(sectionId)
      : null;

    if (stage && target && stage.contains(target)) {
      target.scrollIntoView();
      return;
    }

    const pageTarget =
      sectionId && pageSurface
        ? findOutlineHeading(pageSurface, sectionId)
        : null;

    if (pageTarget) {
      scrollToReadingPosition(pageTarget);
    }
  }, [
    isHtml,
    onOutlineChange,
    pageSurface,
    parsedDocument,
    penaDocument.title,
  ]);

  useEffect(() => {
    function trackActiveSection(): void {
      const surface = documentStageRef.current;

      if (surface) {
        onActiveSectionChange(readActiveSection(surface, pageSurface));
      }
    }

    trackActiveSection();
    window.addEventListener("scroll", trackActiveSection, { passive: true });
    window.addEventListener("resize", trackActiveSection);

    return () => {
      window.removeEventListener("scroll", trackActiveSection);
      window.removeEventListener("resize", trackActiveSection);
    };
  }, [onActiveSectionChange, pageSurface, parsedDocument, penaDocument.title]);

  // The outline links to `#pena-section-N`, which the review page cannot
  // resolve inside the frame, so a link to a page heading scrolls to it here.
  useEffect(() => {
    if (!pageSurface) {
      return;
    }

    const surface = pageSurface;

    function handleSectionLinkClick(event: MouseEvent): void {
      const link = (event.target as Element | null)?.closest?.(
        'a[href^="#"]',
      );
      const sectionId = link?.getAttribute("href")?.slice(1);
      const heading = sectionId ? findOutlineHeading(surface, sectionId) : null;

      if (!heading) {
        return;
      }

      event.preventDefault();
      scrollToReadingPosition(heading);
      window.history.replaceState(window.history.state, "", `#${sectionId}`);
    }

    window.document.addEventListener("click", handleSectionLinkClick);
    return () =>
      window.document.removeEventListener("click", handleSectionLinkClick);
  }, [pageSurface]);

  // Events inside the frame never reach the review page, so its listeners
  // are attached to every document the frame loads.
  useEffect(() => {
    if (!pageSurface) {
      return;
    }

    const frameDocument = pageSurface.ownerDocument;
    const frameWindow = frameDocument.defaultView;
    const handleSelect = () => frameEventsRef.current?.select();
    // Only a key that extends the selection opens the composer. Any other
    // key, Escape included, would reopen it from the selection still
    // showing in the page.
    const handleKeySelect = (event: KeyboardEvent) => {
      if (extendsSelection(event)) {
        frameEventsRef.current?.select();
      }
    };
    const handleClick = (event: MouseEvent) =>
      frameEventsRef.current?.click(event);
    const handleMove = (event: MouseEvent) =>
      frameEventsRef.current?.move(event);
    const handlePointerDown = () => frameEventsRef.current?.pointerDown();
    // A window that comes back with focus inside the frame tells only the
    // frame, so the review page would never refetch a republished version.
    // Focus that moves between the page and Pena itself stays inside the
    // review window and is not a return.
    let leftTheWindow = false;
    const handleFrameBlur = () => {
      window.setTimeout(() => {
        leftTheWindow = !window.document.hasFocus();
      });
    };
    const handleFrameFocus = () => {
      if (leftTheWindow) {
        leftTheWindow = false;
        window.dispatchEvent(new Event("focus"));
      }
    };

    frameDocument.addEventListener("mouseup", handleSelect);
    frameDocument.addEventListener("keyup", handleKeySelect);
    frameDocument.addEventListener("click", handleClick);
    frameDocument.addEventListener("mousemove", handleMove);
    frameDocument.addEventListener("pointerdown", handlePointerDown);
    frameDocument.addEventListener("keydown", forwardFrameShortcut);
    frameWindow?.addEventListener("blur", handleFrameBlur);
    frameWindow?.addEventListener("focus", handleFrameFocus);

    return () => {
      frameDocument.removeEventListener("mouseup", handleSelect);
      frameDocument.removeEventListener("keyup", handleKeySelect);
      frameDocument.removeEventListener("click", handleClick);
      frameDocument.removeEventListener("mousemove", handleMove);
      frameDocument.removeEventListener("pointerdown", handlePointerDown);
      frameDocument.removeEventListener("keydown", forwardFrameShortcut);
      frameWindow?.removeEventListener("blur", handleFrameBlur);
      frameWindow?.removeEventListener("focus", handleFrameFocus);
    };
  }, [pageSurface]);

  useLayoutEffect(() => {
    frameEventsRef.current = {
      select: openSelectionFromSurface,
      click: openDraftAtPoint,
      move: (event) => {
        const root = pageSurface?.ownerDocument.documentElement;

        if (root) {
          updateDraftCursor(root, event.clientX, event.clientY);
        }
      },
      // The composer lives outside the frame, so any press inside is outside.
      pointerDown: () => {
        if (editor.passage) {
          dispatch({ type: "closed" });
        }
      },
    };
  });

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
    const topBarBottom = readTopBarBottom();
    const viewportPadding = 12;
    const minimumTop = topBarBottom + viewportPadding;
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
      editor.passage,
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
    surfaceKey,
  ]);

  function handleDocumentSelection(event: SyntheticEvent<HTMLElement>): void {
    if (
      event.target instanceof Element &&
      event.target.closest("[data-pena-decision-control]")
    ) {
      return;
    }

    openSelectionFromSurface();
  }

  function openSelectionFromSurface(): void {
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

  function openDraftAtPoint(event: PointerPosition): void {
    const selection =
      documentSurfaceRef.current?.ownerDocument.getSelection() ?? null;

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
    updateDraftCursor(event.currentTarget, event.clientX, event.clientY);
  }

  function updateDraftCursor(
    element: HTMLElement,
    clientX: number,
    clientY: number,
  ): void {
    element.style.cursor =
      !editor.passage && findDraftAtPoint(clientX, clientY) ? "pointer" : "";
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

  function openDraftFromSidebar(draft: DraftComment): void {
    const surface = documentSurfaceRef.current;
    const range = surface ? findDraftRange(surface, draft) : null;

    if (!range) {
      openDraftForEditing(draft);
      return;
    }

    scrollRangeToEditorPosition(range);
    dispatch({
      type: "comment-edit-opened",
      draft,
      position: readSelectionPosition(range, documentStageRef.current),
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
    documentSurfaceRef.current?.ownerDocument.getSelection()?.removeAllRanges();
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

  function focusDecision(decisionId: string): void {
    const decision = Array.from(
      documentSurfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-decision-id]",
      ) ?? [],
    ).find((element) => element.dataset.decisionId === decisionId);

    decision?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    decision
      ?.querySelector<HTMLButtonElement>(".decision-choice.selected")
      ?.focus({ preventScroll: true });
    onNoticeClear();
  }

  function removePendingFeedback(draft: DraftFeedback): void {
    if (draft.kind === "comment") {
      onDraftDeleted(draft.id);

      if (editor.editingCommentId === draft.id) {
        dispatch({ type: "closed" });
      }
    } else {
      onDecisionDraftChanged(draft.decisionId, null);
    }

    onNoticeClear();
  }

  function viewPendingFeedback(): void {
    if (!isPendingFeedbackOpen) {
      onPendingFeedbackOpenChange(true);
      window.requestAnimationFrame(focusPendingFeedback);
      return;
    }

    focusPendingFeedback();
  }

  function focusPendingFeedback(): void {
    const panel = pendingFeedbackPanelRef.current;

    panel?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    const firstFeedback = panel?.querySelector<HTMLButtonElement>(
      ".pending-feedback-open",
    );

    if (firstFeedback) {
      firstFeedback.focus({ preventScroll: true });
    }
  }

  return (
    <>
      <div
        className={`document-review-layout${
          isPendingPanelVisible ? " with-pending-feedback" : ""
        }`}
      >
        <div
          className={`document-stage${isHtml ? " html-stage" : ""}`}
          ref={documentStageRef}
        >
          {/* A page is its own design; its title lives in the review bar. */}
          {isHtml ? null : <DocumentPageTitle title={penaDocument.title} />}
          {isHtml ? (
            <HtmlDocumentFrame
              content={penaDocument.content}
              title={penaDocument.title}
              onDocumentLoad={handleFrameLoad}
            />
          ) : (
            <article
              className="markdown-body"
              ref={documentSurfaceRef}
              onMouseUp={handleDocumentSelection}
              onKeyUp={handleDocumentSelection}
              onClick={openDraftAtPoint}
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
          )}

          {draftComments.map((draft) => {
            const position = draftPositions[draft.id];
            const feedbackPosition =
              draftFeedback.findIndex((item) => item.id === draft.id) + 1;

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
                  aria-label={`Edit comment ${feedbackPosition}`}
                  title={draft.comment}
                  onClick={() => openDraftForEditing(draft)}
                >
                  {feedbackPosition.toString().padStart(2, "0")}
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

        {isPendingPanelVisible ? (
          <PendingFeedbackPanel
            feedback={draftFeedback}
            onActivateComment={openDraftFromSidebar}
            onActivateDecision={focusDecision}
            onClose={() => onPendingFeedbackOpenChange(false)}
            onRemove={removePendingFeedback}
            panelRef={pendingFeedbackPanelRef}
          />
        ) : null}
      </div>

      {!editor.passage ? (
        <FeedbackBar
          commentCount={draftComments.length}
          decisionCount={draftDecisions.length}
          instruction={feedbackInstruction}
          isInstructionComposerOpen={isInstructionComposerOpen}
          isPendingFeedbackOpen={isPendingFeedbackOpen}
          isSubmitting={isSubmitting}
          notice={notice}
          onInstructionChange={onFeedbackInstructionChange}
          onInstructionComposerOpenChange={onInstructionComposerOpenChange}
          onSubmit={onSubmitFeedback}
          onViewPending={viewPendingFeedback}
          isMinimized={isFeedbackMinimized}
          onMinimizedChange={onFeedbackMinimizedChange}
        />
      ) : null}
    </>
  );
}

function readLocationHash(): string | null {
  const hash = window.location.hash.slice(1);

  if (!hash) {
    return null;
  }

  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

/** Shift with a movement key, or letting go of Shift after one. */
function extendsSelection(event: KeyboardEvent): boolean {
  return (
    event.key === "Shift" ||
    (event.shiftKey && /^(Arrow|Home$|End$|Page)/.test(event.key))
  );
}

/**
 * Shortcuts pressed inside the frame never reach the review page. Replays the
 * ones Pena listens for there, unless the page claimed the key itself.
 */
function forwardFrameShortcut(event: KeyboardEvent): void {
  if (
    event.defaultPrevented ||
    !(event.metaKey || event.ctrlKey || event.key === "Escape")
  ) {
    return;
  }

  const forwarded = new KeyboardEvent("keydown", {
    key: event.key,
    code: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    repeat: event.repeat,
    bubbles: true,
    cancelable: true,
  });

  if (!window.document.dispatchEvent(forwarded)) {
    event.preventDefault();
  }
}

function scrollRangeToEditorPosition(range: Range): void {
  const anchorRect = toViewportRect(
    Array.from(range.getClientRects()).at(-1) ?? range.getBoundingClientRect(),
    range.startContainer,
    window.document,
  );
  const topBarBottom = readTopBarBottom();
  const viewportPadding = 28;
  const desiredTop = topBarBottom + viewportPadding;

  if (Math.abs(anchorRect.top - desiredTop) < 1) {
    return;
  }

  window.scrollTo({
    top: Math.max(0, window.scrollY + anchorRect.top - desiredTop),
    behavior: "auto",
  });
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
