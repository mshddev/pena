import {
  findTextRange,
  readSelection,
  readTextOffset,
} from "../../selection";
import type { AnchoredSelection } from "./editor-state";
import type {
  DraftComment,
  DraftPosition,
  SelectionPosition,
} from "./types";

export const DOCUMENT_ANCHOR_ID = "__pena-document__";

const COMMENT_POPOVER_WIDTH = 360;
const COMMENT_POPOVER_GAP = 10;
const COMMENT_MARKER_SIZE = 20;
const COMMENT_MARKER_GAP = 4;

export function readAnchoredSelection(
  surface: HTMLElement,
  stage: HTMLElement,
): AnchoredSelection | null {
  const selection = window.getSelection();
  const passage = readSelection(surface, selection);

  if (!passage || !selection?.rangeCount) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startElement = readClosestElement(range.startContainer);
  const endElement = readClosestElement(range.endContainer);
  const startAnchor = startElement?.closest<HTMLElement>(
    "[data-annotation-block]",
  );
  const endAnchor = endElement?.closest<HTMLElement>(
    "[data-annotation-block]",
  );
  const anchor =
    startAnchor && startAnchor === endAnchor ? startAnchor : surface;
  const anchorId =
    anchor === surface ? DOCUMENT_ANCHOR_ID : anchor.dataset.annotationBlock;
  const anchorOffset = readTextOffset(anchor, range, passage.selectedText);
  const position = readSelectionPosition(range, stage);

  if (!anchorId || anchorOffset === null || !position) {
    return null;
  }

  return { passage, anchorId, anchorOffset, position };
}

export function findDraftCommentAtPoint(
  surface: HTMLElement,
  drafts: DraftComment[],
  clientX: number,
  clientY: number,
): DraftComment | null {
  for (const draft of [...drafts].reverse()) {
    const range = findDraftRange(surface, draft);

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

export function findDraftRange(
  surface: HTMLElement,
  draft: DraftComment,
): Range | null {
  const anchor = resolveAnnotationAnchor(surface, draft.anchorId);
  return anchor
    ? findTextRange(anchor, draft.selectedText, draft.anchorOffset)
    : null;
}

export function resolveAnnotationAnchor(
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

export function readSelectionPosition(
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
  const fitsToRight = positionToRight + popoverWidth <= stageRect.width;
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

export function readMarkerPosition(
  range: Range,
  stage: HTMLElement,
): SelectionPosition {
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

export function haveSameDraftPositions(
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

export function readAnnotationBlockId(
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

function readClosestElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

function readRangeAnchorRect(range: Range): DOMRect {
  return (
    Array.from(range.getClientRects()).at(-1) ?? range.getBoundingClientRect()
  );
}
