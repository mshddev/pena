import {
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

import type { SelectedPassage } from "../../selection";
import {
  findAnchoredTextRange,
  findDraftRange,
  haveSameDraftPositions,
  readMarkerPosition,
} from "./annotation";
import { readNodeWindow } from "./frame-geometry";
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

/**
 * `surfaceKey` changes whenever the surface renders new content or, for a
 * page in a frame, loads a new document. Highlights live in the surface's own
 * document, which is the frame's rather than the review page's.
 */
export function useDraftHighlights(
  surfaceRef: RefObject<HTMLElement | null>,
  surfaceKey: unknown,
  draftComments: DraftComment[],
): void {
  useEffect(() => {
    const ownerDocument = surfaceRef.current?.ownerDocument ?? document;
    const styleElement = ownerDocument.createElement("style");
    styleElement.dataset.penaAnnotation = "";
    styleElement.textContent = draftHighlightStyles;
    ownerDocument.head.append(styleElement);

    return () => styleElement.remove();
  }, [surfaceKey, surfaceRef]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const surfaceWindow = surface ? readNodeWindow(surface) : null;
    const highlights = surfaceWindow?.CSS?.highlights;
    const HighlightConstructor = surfaceWindow?.Highlight;

    if (!surface || !highlights || !HighlightConstructor) {
      return;
    }

    const ranges = draftComments.flatMap((draft) => {
      const range = findDraftRange(surface, draft);
      return range ? [range] : [];
    });

    highlights.set("pena-draft-comments", new HighlightConstructor(...ranges));

    return () => {
      highlights.delete("pena-draft-comments");
    };
  }, [surfaceKey, draftComments, surfaceRef]);
}

export function useDraftPositions(
  surfaceRef: RefObject<HTMLElement | null>,
  stageRef: RefObject<HTMLElement | null>,
  surfaceKey: unknown,
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

    // A frame's content reflows in the frame's realm, so observe it there,
    // and a frame scrolled sideways moves its text under the markers.
    const surfaceWindow = readNodeWindow(surfaceElement);
    const frameWindow = surfaceWindow === window ? null : surfaceWindow;
    const Observer = surfaceWindow?.ResizeObserver ?? ResizeObserver;
    const resizeObserver = new Observer(updateDraftPositions);
    resizeObserver.observe(surfaceElement);
    window.addEventListener("resize", updateDraftPositions);
    frameWindow?.addEventListener("scroll", updateDraftPositions);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDraftPositions);
      frameWindow?.removeEventListener("scroll", updateDraftPositions);
    };
  }, [surfaceKey, draftComments, stageRef, surfaceRef]);

  return draftPositions;
}

export function subscribeToSelectionPosition(
  surface: HTMLElement,
  anchorId: string,
  anchorOffset: number,
  passage: SelectedPassage,
  onPositionChange: (range: Range) => void,
): () => void {
  function updateSelectionPosition(): void {
    const range = findAnchoredTextRange(
      surface,
      anchorId,
      passage.selectedText,
      anchorOffset,
      passage,
    );

    if (range) {
      onPositionChange(range);
    }
  }

  const surfaceWindow = readNodeWindow(surface);
  const frameWindow = surfaceWindow === window ? null : surfaceWindow;

  window.addEventListener("resize", updateSelectionPosition);
  frameWindow?.addEventListener("scroll", updateSelectionPosition);

  return () => {
    window.removeEventListener("resize", updateSelectionPosition);
    frameWindow?.removeEventListener("scroll", updateSelectionPosition);
  };
}
