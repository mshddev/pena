import {
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

import { findTextRange } from "../../selection";
import {
  findDraftRange,
  haveSameDraftPositions,
  readMarkerPosition,
  resolveAnnotationAnchor,
} from "./annotation";
import type { DraftComment, DraftPosition } from "./types";

const draftHighlightStyles = `
  ::highlight(pena-draft-comments) {
    background: rgb(217 164 65 / 20%);
    text-decoration: underline;
    text-decoration-color: rgb(237 187 91 / 70%);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
`;

export function useDraftHighlights(
  surfaceRef: RefObject<HTMLElement | null>,
  documentContent: string,
  draftComments: DraftComment[],
): void {
  useEffect(() => {
    const styleElement = document.createElement("style");
    styleElement.textContent = draftHighlightStyles;
    document.head.append(styleElement);

    return () => styleElement.remove();
  }, []);

  useEffect(() => {
    if (!("highlights" in CSS) || typeof Highlight === "undefined") {
      return;
    }

    const surface = surfaceRef.current;

    if (!surface) {
      return;
    }

    const ranges = draftComments.flatMap((draft) => {
      const range = findDraftRange(surface, draft);
      return range ? [range] : [];
    });

    CSS.highlights.set("pena-draft-comments", new Highlight(...ranges));

    return () => {
      CSS.highlights.delete("pena-draft-comments");
    };
  }, [documentContent, draftComments, surfaceRef]);
}

export function useDraftPositions(
  surfaceRef: RefObject<HTMLElement | null>,
  stageRef: RefObject<HTMLElement | null>,
  documentContent: string,
  draftComments: DraftComment[],
): Record<string, DraftPosition> {
  const [draftPositions, setDraftPositions] = useState<
    Record<string, DraftPosition>
  >({});

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const stage = stageRef.current;

    if (!surface || !stage) {
      return;
    }

    const surfaceElement = surface;
    const stageElement = stage;

    function updateDraftPositions(): void {
      const nextPositions: Record<string, DraftPosition> = {};

      for (const draft of draftComments) {
        const range = findDraftRange(surfaceElement, draft);

        if (range) {
          nextPositions[draft.id] = {
            marker: readMarkerPosition(range, stageElement),
          };
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
  }, [documentContent, draftComments, stageRef, surfaceRef]);

  return draftPositions;
}

export function subscribeToSelectionPosition(
  surface: HTMLElement,
  anchorId: string,
  anchorOffset: number,
  selectedText: string,
  onPositionChange: (range: Range) => void,
): () => void {
  function updateSelectionPosition(): void {
    const anchor = resolveAnnotationAnchor(surface, anchorId);
    const range = anchor
      ? findTextRange(anchor, selectedText, anchorOffset)
      : null;

    if (range) {
      onPositionChange(range);
    }
  }

  window.addEventListener("resize", updateSelectionPosition);
  return () => window.removeEventListener("resize", updateSelectionPosition);
}
