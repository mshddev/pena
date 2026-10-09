import {
  parseExcalidrawScene,
  type CanvasBounds,
  type CanvasTarget,
  type ExcalidrawScene,
  type PenaDocument,
} from "@pena/contracts";
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  boundsBetween,
  boundsToViewport,
  createCanvasTarget,
  describeCanvasElements,
  findElementAtPoint,
  findElementsInBounds,
  readCanvasSections,
  readElementBounds,
  viewportToScene,
  type CanvasElement,
  type CanvasPoint,
  type CanvasViewport,
} from "../canvas-scene";
import type { OutlineSection } from "../outline";
import type { DraftComment, DraftFeedback, Notice } from "../types";
import { CommentComposer } from "./CommentComposer";
import type { CanvasHandle } from "./ExcalidrawCanvas";
import { FeedbackBar } from "./FeedbackBar";
import { PendingFeedbackPanel } from "./PendingFeedbackPanel";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

// Excalidraw is a large bundle, so only a canvas document downloads it. Its
// fonts come from Pena itself, set before the bundle first runs, so a canvas
// renders without the network (vite.config.ts copies them).
const ExcalidrawCanvas = lazy(() => {
  window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
  return import("./ExcalidrawCanvas");
});

/** Canvas comments are anchored by their target, not by a text offset. */
export const CANVAS_ANCHOR_ID = "__pena-canvas__";

/** Farther than this, in pixels, a press is a drag rather than a click. */
const CLICK_SLOP = 4;
const POPOVER_WIDTH = 360;
const POPOVER_GAP = 14;
const POPOVER_EDGE = 12;
/** Room kept below the popover's top, so its buttons stay on the canvas. */
const POPOVER_RESERVED_HEIGHT = 300;
const SECTION_PREFIX = "pena-section-";
const CANVAS_MIN_HEIGHT = 360;
const ZOOM_STEP = 1.25;

interface CanvasEditor {
  target: CanvasTarget;
  selectedText: string;
  text: string;
  editingCommentId: string | null;
}

interface PressState {
  pointerId: number;
  start: CanvasPoint;
  isAreaSelection: boolean;
}

interface CanvasDocumentViewerProps {
  document: PenaDocument;
  draftFeedback: DraftFeedback[];
  feedbackInstruction: string;
  isInstructionComposerOpen: boolean;
  isPendingFeedbackOpen: boolean;
  isSubmitting: boolean;
  notice: Notice;
  onDraftSaved: (draft: DraftComment) => void;
  onDraftDeleted: (draftId: string) => void;
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

/**
 * Reviews an Excalidraw scene: the reader pans and zooms the canvas, clicks
 * an element (or Shift-drags over an area) to comment on it, and the comment
 * carries the element ids back to the agent.
 */
export function CanvasDocumentViewer({
  document: penaDocument,
  draftFeedback,
  feedbackInstruction,
  isInstructionComposerOpen,
  isPendingFeedbackOpen,
  isSubmitting,
  notice,
  onDraftSaved,
  onDraftDeleted,
  onNoticeClear,
  onFeedbackInstructionChange,
  onInstructionComposerOpenChange,
  onPendingFeedbackOpenChange,
  onSubmitFeedback,
  isFeedbackMinimized,
  onFeedbackMinimizedChange,
  onOutlineChange,
  onActiveSectionChange,
}: CanvasDocumentViewerProps) {
  const parsed = useMemo(
    () => readScene(penaDocument.content),
    [penaDocument.content],
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CanvasHandle | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const activePointersRef = useRef(new Set<number>());
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const pendingFeedbackPanelRef = useRef<HTMLElement>(null);
  const didRestoreLocationHashRef = useRef(false);
  const [viewport, setViewport] = useState<CanvasViewport | null>(null);
  const [elements, setElements] = useState<readonly CanvasElement[]>([]);
  const [editor, setEditor] = useState<CanvasEditor | null>(null);
  const [area, setArea] = useState<CanvasBounds | null>(null);
  const draftComments = useMemo(
    () =>
      draftFeedback.filter(
        (draft): draft is DraftComment => draft.kind === "comment",
      ),
    [draftFeedback],
  );
  const sections = useMemo(() => readCanvasSections(elements), [elements]);
  const isPendingPanelVisible =
    isPendingFeedbackOpen && draftFeedback.length > 0;

  const handleReady = useCallback((handle: CanvasHandle) => {
    handleRef.current = handle;
    setElements(handle.getElements());
    setViewport(handle.getViewport());
  }, []);

  const handleSceneChange = useCallback(() => {
    const handle = handleRef.current;

    if (handle) {
      setElements(handle.getElements());
    }
  }, []);

  useFitToWindow(boxRef);

  useEffect(() => {
    onOutlineChange(
      sections.map((section, index) => ({
        id: `${SECTION_PREFIX}${index}`,
        text: section.text,
        depth: 0,
      })),
    );
  }, [onOutlineChange, sections]);

  const sectionBounds = useMemo(() => {
    const byId = new Map(elements.map((element) => [element.id, element]));

    return sections.map((section) => {
      const frame = byId.get(section.elementId);
      return frame ? readElementBounds(frame) : null;
    });
  }, [elements, sections]);

  // The frame under the middle of the canvas is the section being read.
  useEffect(() => {
    const box = boxRef.current;

    if (!viewport || !box) {
      onActiveSectionChange(null);
      return;
    }

    const center = viewportToScene(
      { x: box.clientWidth / 2, y: box.clientHeight / 2 },
      viewport,
    );
    const index = sectionBounds.findIndex(
      (bounds) =>
        bounds !== null &&
        center.x >= bounds.x &&
        center.x <= bounds.x + bounds.width &&
        center.y >= bounds.y &&
        center.y <= bounds.y + bounds.height,
    );

    onActiveSectionChange(index === -1 ? null : `${SECTION_PREFIX}${index}`);
  }, [onActiveSectionChange, sectionBounds, viewport]);

  const showSection = useCallback(
    (sectionId: string): boolean => {
      const index = Number(sectionId.slice(SECTION_PREFIX.length));
      const frame = elements.find(
        (element) => element.id === sections[index]?.elementId,
      );

      if (!sectionId.startsWith(SECTION_PREFIX) || !frame) {
        return false;
      }

      handleRef.current?.showBounds(readElementBounds(frame), { fit: true });
      return true;
    },
    [elements, sections],
  );

  // The outline links to `#pena-section-N`, which names a frame on the
  // canvas rather than an element on the page.
  useEffect(() => {
    function handleSectionLinkClick(event: MouseEvent): void {
      const link = (event.target as Element | null)?.closest?.(
        `a[href^="#${SECTION_PREFIX}"]`,
      );
      const sectionId = link?.getAttribute("href")?.slice(1);

      if (sectionId && showSection(sectionId)) {
        event.preventDefault();
        window.history.replaceState(window.history.state, "", `#${sectionId}`);
      }
    }

    window.document.addEventListener("click", handleSectionLinkClick);
    return () =>
      window.document.removeEventListener("click", handleSectionLinkClick);
  }, [showSection]);

  useEffect(() => {
    if (didRestoreLocationHashRef.current || sections.length === 0) {
      return;
    }

    didRestoreLocationHashRef.current = true;
    showSection(window.location.hash.slice(1));
  }, [sections, showSection]);

  useEffect(() => {
    if (editor?.editingCommentId === null && editor.text === "") {
      commentInputRef.current?.focus({ preventScroll: true });
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setEditor(null);
      }
    }

    // A press inside the canvas is handled as a click on it; anywhere else
    // outside the composer closes it.
    function handleOutsidePointerDown(event: PointerEvent): void {
      const target = event.target;

      if (
        target instanceof Node &&
        !composerRef.current?.contains(target) &&
        !boxRef.current?.contains(target)
      ) {
        setEditor(null);
      }
    }

    window.document.addEventListener("keydown", handleKeyDown);
    window.document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      window.document.removeEventListener("keydown", handleKeyDown);
      window.document.removeEventListener(
        "pointerdown",
        handleOutsidePointerDown,
      );
    };
  }, [editor]);

  function readBoxPoint(event: ReactPointerEvent<HTMLElement>): CanvasPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // Excalidraw pans on a drag, so a press only becomes a comment when it is
  // a click, or a drag with Shift held, which Pena claims before Excalidraw
  // sees it.
  function handlePointerDownCapture(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (event.button !== 0 || !viewport) {
      return;
    }

    // A primary pointer starts a fresh gesture; a second finger turns it
    // into a pinch, which pans and zooms rather than picks.
    const activePointers = activePointersRef.current;

    if (event.isPrimary) {
      activePointers.clear();
    }

    activePointers.add(event.pointerId);

    if (activePointers.size > 1) {
      pressRef.current = null;
      setArea(null);
      return;
    }

    const start = readBoxPoint(event);
    const isAreaSelection = event.shiftKey;

    pressRef.current = { pointerId: event.pointerId, start, isAreaSelection };

    if (isAreaSelection) {
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setArea({ ...start, width: 0, height: 0 });
    }
  }

  function handlePointerMoveCapture(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    const press = pressRef.current;

    if (press?.isAreaSelection && press.pointerId === event.pointerId) {
      event.stopPropagation();
      setArea(boundsBetween(press.start, readBoxPoint(event)));
    }
  }

  function handlePointerUpCapture(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    activePointersRef.current.delete(event.pointerId);
    const press = pressRef.current;

    if (!press || press.pointerId !== event.pointerId || !viewport) {
      return;
    }

    pressRef.current = null;
    const end = readBoxPoint(event);
    const isClick =
      Math.hypot(end.x - press.start.x, end.y - press.start.y) <= CLICK_SLOP;

    if (press.isAreaSelection) {
      event.stopPropagation();
      setArea(null);
    }

    if (isClick) {
      openAtPoint(viewportToScene(end, viewport));
    } else if (press.isAreaSelection) {
      openForArea(
        boundsBetween(
          viewportToScene(press.start, viewport),
          viewportToScene(end, viewport),
        ),
      );
    }
  }

  function handlePointerCancelCapture(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    activePointersRef.current.delete(event.pointerId);
    pressRef.current = null;
    setArea(null);
  }

  function openAtPoint(point: CanvasPoint): void {
    if (!viewport) {
      return;
    }

    const hit = findElementAtPoint(elements, point, viewport.zoom);

    if (!hit) {
      setEditor(null);
      return;
    }

    const existingDraft = draftComments.find(
      (draft) =>
        draft.target?.elementIds.length === 1 &&
        draft.target.elementIds[0] === hit.id,
    );

    if (existingDraft) {
      openDraft(existingDraft);
      return;
    }

    openEditor([hit], null);
  }

  function openForArea(bounds: CanvasBounds): void {
    const picked = findElementsInBounds(elements, bounds);
    openEditor(picked, picked.length > 0 ? null : bounds);
  }

  function openEditor(
    picked: readonly CanvasElement[],
    emptyArea: CanvasBounds | null,
  ): void {
    setEditor({
      target: createCanvasTarget(picked, emptyArea),
      selectedText: describeCanvasElements(elements, picked),
      text: "",
      editingCommentId: null,
    });
    onNoticeClear();
  }

  function openDraft(draft: DraftComment): void {
    if (!draft.target) {
      return;
    }

    setEditor({
      target: draft.target,
      selectedText: draft.selectedText,
      text: draft.comment,
      editingCommentId: draft.id,
    });
    onNoticeClear();
  }

  function openDraftFromSidebar(draft: DraftComment): void {
    if (draft.target) {
      handleRef.current?.showBounds(draft.target.bounds, { fit: false });
    }

    openDraft(draft);
  }

  function saveComment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!editor || !editor.text.trim()) {
      return;
    }

    onDraftSaved({
      kind: "comment",
      id: editor.editingCommentId ?? crypto.randomUUID(),
      selectedText: editor.selectedText,
      contextBefore: "",
      contextAfter: "",
      comment: editor.text.trim(),
      target: editor.target,
      anchorId: CANVAS_ANCHOR_ID,
      anchorOffset: 0,
    });
    setEditor(null);
  }

  function deleteEditingComment(): void {
    if (editor?.editingCommentId) {
      onDraftDeleted(editor.editingCommentId);
      setEditor(null);
    }
  }

  function removePendingFeedback(draft: DraftFeedback): void {
    onDraftDeleted(draft.id);

    if (editor?.editingCommentId === draft.id) {
      setEditor(null);
    }

    onNoticeClear();
  }

  function viewPendingFeedback(): void {
    if (!isPendingFeedbackOpen) {
      onPendingFeedbackOpenChange(true);
    }

    window.requestAnimationFrame(() => {
      pendingFeedbackPanelRef.current
        ?.querySelector<HTMLButtonElement>(".pending-feedback-open")
        ?.focus({ preventScroll: true });
    });
  }

  const box = boxRef.current;
  // The canvas runs under the feedback bar, so its own controls move up
  // while the full bar is out.
  const isUnderFeedbackBar = !editor && !(isFeedbackMinimized ?? false);
  const editorBounds =
    editor && viewport ? boundsToViewport(editor.target.bounds, viewport) : null;

  return (
    <>
      <div
        className={`document-review-layout${
          isPendingPanelVisible ? " with-pending-feedback" : ""
        }`}
      >
        <div className="document-stage canvas-stage">
          {parsed.error !== null ? (
            <p className="canvas-error" role="alert">
              This canvas could not be read: {parsed.error}
            </p>
          ) : (
            <div
              className={`canvas-document${area ? " selecting-area" : ""}${
                isUnderFeedbackBar ? " under-feedback-bar" : ""
              }`}
              ref={boxRef}
            >
              <div
                className="canvas-document-surface"
                onPointerDownCapture={handlePointerDownCapture}
                onPointerMoveCapture={handlePointerMoveCapture}
                onPointerUpCapture={handlePointerUpCapture}
                onPointerCancelCapture={handlePointerCancelCapture}
              >
                <CanvasErrorBoundary scene={parsed.scene}>
                  <Suspense fallback={<CanvasLoading />}>
                    <ExcalidrawCanvas
                      scene={parsed.scene}
                      onReady={handleReady}
                      onSceneChange={handleSceneChange}
                      onViewportChange={setViewport}
                    />
                  </Suspense>
                </CanvasErrorBoundary>
              </div>

              {viewport ? (
                <div className="canvas-annotations" data-pena-annotation>
                  {draftComments.map((draft) => {
                    if (!draft.target) {
                      return null;
                    }

                    const bounds = boundsToViewport(draft.target.bounds, viewport);
                    const position =
                      draftFeedback.findIndex((item) => item.id === draft.id) + 1;
                    const isEditing = editor?.editingCommentId === draft.id;

                    return (
                      <div key={draft.id}>
                        <div
                          className={`canvas-target-outline${
                            isEditing ? " active" : ""
                          }`}
                          style={outlineStyle(bounds)}
                        />
                        <button
                          className="comment-marker canvas-comment-marker"
                          type="button"
                          aria-label={`Edit comment ${position}`}
                          title={draft.comment}
                          style={{
                            left: bounds.x + bounds.width,
                            top: bounds.y,
                          }}
                          onClick={() => openDraft(draft)}
                        >
                          {position.toString().padStart(2, "0")}
                        </button>
                      </div>
                    );
                  })}

                  {editorBounds && editor?.editingCommentId === null ? (
                    <div
                      className="canvas-target-outline active"
                      style={outlineStyle(editorBounds)}
                    />
                  ) : null}

                  {area ? (
                    <div className="canvas-area-selection" style={outlineStyle(area)} />
                  ) : null}

                  {editor && editorBounds ? (
                    <div
                      className="selection-comment-popover canvas-comment-popover"
                      ref={composerRef}
                      style={placeComposer(
                        editorBounds,
                        box?.clientWidth ?? 0,
                        box?.clientHeight ?? 0,
                      )}
                    >
                      <CommentComposer
                        passage={{
                          selectedText: editor.selectedText,
                          contextBefore: "",
                          contextAfter: "",
                        }}
                        isEditing={editor.editingCommentId !== null}
                        commentText={editor.text}
                        commentInputRef={commentInputRef}
                        onCommentChange={(text) =>
                          setEditor((current) =>
                            current ? { ...current, text } : current,
                          )
                        }
                        onSubmit={saveComment}
                        onCancel={() => setEditor(null)}
                        onDelete={
                          editor.editingCommentId
                            ? deleteEditingComment
                            : undefined
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {viewport ? (
                <CanvasZoomControls
                  zoom={viewport.zoom}
                  onZoomBy={(factor) => handleRef.current?.zoomBy(factor)}
                  onFit={() => handleRef.current?.fit()}
                />
              ) : null}
              <p className="canvas-hint">
                Click an element to comment · <kbd>Shift</kbd>-drag for an area
              </p>
            </div>
          )}
        </div>

        {isPendingPanelVisible ? (
          <PendingFeedbackPanel
            feedback={draftFeedback}
            onActivateComment={openDraftFromSidebar}
            onActivateDecision={() => undefined}
            onClose={() => onPendingFeedbackOpenChange(false)}
            onRemove={removePendingFeedback}
            panelRef={pendingFeedbackPanelRef}
          />
        ) : null}
      </div>

      {!editor ? (
        <FeedbackBar
          commentCount={draftComments.length}
          decisionCount={0}
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
          commentHint="click an element"
        />
      ) : null}
    </>
  );
}

/** A scene shown without review controls: archived, or an older version. */
export function ReadOnlyCanvas({ content }: { content: string }) {
  const parsed = useMemo(() => readScene(content), [content]);

  if (parsed.error !== null) {
    return (
      <p className="canvas-error" role="alert">
        This canvas could not be read: {parsed.error}
      </p>
    );
  }

  return (
    <div className="canvas-document">
      <div className="canvas-document-surface">
        <CanvasErrorBoundary scene={parsed.scene}>
          <Suspense fallback={<CanvasLoading />}>
            <ExcalidrawCanvas scene={parsed.scene} />
          </Suspense>
        </CanvasErrorBoundary>
      </div>
    </div>
  );
}

/**
 * A scene the reader edits with Excalidraw's own tools. `onTouch` fires on
 * the reader's first pointer or key press, which tells their changes apart
 * from the scene loading.
 */
export function EditableCanvas({
  content,
  onReady,
  onSceneChange,
  onTouch,
}: {
  content: string;
  onReady: (handle: CanvasHandle) => void;
  onSceneChange: () => void;
  onTouch: () => void;
}) {
  const parsed = useMemo(() => readScene(content), [content]);

  if (parsed.error !== null) {
    return (
      <p className="canvas-error" role="alert">
        This canvas could not be read: {parsed.error}
      </p>
    );
  }

  return (
    <div
      className="canvas-editor"
      onPointerDownCapture={onTouch}
      onKeyDownCapture={onTouch}
    >
      <CanvasErrorBoundary scene={parsed.scene}>
        <Suspense fallback={<CanvasLoading />}>
          <ExcalidrawCanvas
            scene={parsed.scene}
            editable
            onReady={onReady}
            onSceneChange={onSceneChange}
          />
        </Suspense>
      </CanvasErrorBoundary>
    </div>
  );
}

/**
 * The element's distance from the top of the page as laid out. Unlike its
 * bounding box this ignores transforms, so the canvas's entrance animation
 * cannot leave it short.
 */
function readLayoutTop(element: HTMLElement): number {
  let top = 0;

  for (
    let node: HTMLElement | null = element;
    node;
    node = node.offsetParent as HTMLElement | null
  ) {
    top += node.offsetTop;
  }

  return top;
}

/**
 * Ends the canvas at the bottom of the window, so the whole canvas shows
 * without scrolling the page. The review bar and the feedback bar float over
 * it rather than taking room from it.
 */
function useFitToWindow(boxRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    function fit(): void {
      const box = boxRef.current;

      if (!box) {
        return;
      }

      const top = readLayoutTop(box);
      const height = `${Math.max(
        CANVAS_MIN_HEIGHT,
        window.innerHeight - top,
      )}px`;

      // Setting the same height again would only wake the observer.
      if (box.style.height !== height) {
        box.style.height = height;
      }
    }

    fit();
    // Anything above the canvas moves its top: the canvas appearing after
    // an error, the outline strip on a narrow window. Each changes the
    // page's height, so watching the page catches them all.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(window.document.body);
    window.addEventListener("resize", fit);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [boxRef]);
}

/** Excalidraw's own controls are hidden, so the canvas brings its zoom. */
function CanvasZoomControls({
  zoom,
  onZoomBy,
  onFit,
}: {
  zoom: number;
  onZoomBy: (factor: number) => void;
  onFit: () => void;
}) {
  return (
    <div className="canvas-zoom-controls" role="group" aria-label="Zoom">
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => onZoomBy(1 / ZOOM_STEP)}
      >
        −
      </button>
      <button
        className="canvas-zoom-level"
        type="button"
        aria-label="Fit the canvas"
        title="Fit the canvas"
        onClick={onFit}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => onZoomBy(ZOOM_STEP)}
      >
        +
      </button>
    </div>
  );
}

interface CanvasErrorBoundaryProps {
  /** A new scene gets a fresh attempt. */
  scene: ExcalidrawScene;
  children: ReactNode;
}

/**
 * A scene Excalidraw cannot draw, or a bundle that failed to load, shows
 * why in place of the canvas instead of blanking the whole review page.
 */
interface CanvasErrorBoundaryState {
  error: Error | null;
  scene: ExcalidrawScene;
}

class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { error: null, scene: this.props.scene };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: CanvasErrorBoundaryProps,
    state: CanvasErrorBoundaryState,
  ) {
    return props.scene === state.scene
      ? null
      : { error: null, scene: props.scene };
  }

  render() {
    return this.state.error ? (
      <p className="canvas-error canvas-draw-error" role="alert">
        This canvas could not be drawn: {this.state.error.message}
      </p>
    ) : (
      this.props.children
    );
  }
}

function CanvasLoading() {
  return (
    <div className="canvas-loading" aria-live="polite">
      Loading canvas…
    </div>
  );
}

type ParsedScene =
  | { scene: ExcalidrawScene; error: null }
  | { scene: null; error: string };

function readScene(content: string): ParsedScene {
  try {
    return { scene: parseExcalidrawScene(content), error: null };
  } catch (error) {
    return {
      scene: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function outlineStyle(bounds: CanvasBounds) {
  return {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * Beside the target on whichever side has room, else below or above it, and
 * kept on the canvas so its buttons stay reachable.
 */
function placeComposer(
  target: CanvasBounds,
  boxWidth: number,
  boxHeight: number,
): { left: number; top: number } {
  const right = target.x + target.width + POPOVER_GAP;
  const leftSide = target.x - POPOVER_GAP - POPOVER_WIDTH;
  const below = target.y + target.height + POPOVER_GAP;
  const maxLeft = Math.max(POPOVER_EDGE, boxWidth - POPOVER_WIDTH - POPOVER_EDGE);
  const maxTop = Math.max(POPOVER_EDGE, boxHeight - POPOVER_RESERVED_HEIGHT);
  const clampLeft = (left: number) => Math.min(Math.max(POPOVER_EDGE, left), maxLeft);
  const clampTop = (top: number) => Math.min(Math.max(POPOVER_EDGE, top), maxTop);

  if (right + POPOVER_WIDTH <= boxWidth - POPOVER_EDGE) {
    return { left: right, top: clampTop(target.y) };
  }

  if (leftSide >= POPOVER_EDGE) {
    return { left: leftSide, top: clampTop(target.y) };
  }

  if (below <= maxTop) {
    return { left: clampLeft(target.x), top: below };
  }

  return {
    left: clampLeft(target.x),
    top: clampTop(target.y - POPOVER_GAP - POPOVER_RESERVED_HEIGHT),
  };
}
