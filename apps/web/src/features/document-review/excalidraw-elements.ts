/**
 * Turns a stored scene into the elements Excalidraw draws. This module
 * imports Excalidraw, so only the lazily loaded canvas and the download of a
 * canvas reach it.
 */
import {
  convertToExcalidrawElements,
  restore,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import {
  isFrameElementType,
  isSavedSceneElement,
  type ExcalidrawScene,
  type ExcalidrawSceneElement,
} from "@pena/contracts";

import {
  readElementBounds,
  unionBounds,
  type CanvasElement,
} from "./canvas-scene";
import {
  keepSavedBindings,
  listBoundArrows,
  readExpansionInput,
} from "./mixed-scene";

/** Room around a frame's members, enough for text that widens on re-measure. */
const FRAME_PADDING = 24;

export interface PreparedScene {
  elements: ExcalidrawElement[];
  appState: Pick<AppState, "viewBackgroundColor" | "frameRendering">;
  files: BinaryFiles;
}

/** How Excalidraw draws frames when a scene says nothing about them. */
const SAVED_FRAME_RENDERING: AppState["frameRendering"] = {
  enabled: true,
  name: true,
  outline: true,
  clip: true,
};

/**
 * A scene saved by Excalidraw loads as it is. One written by hand is a list
 * of skeletons (shapes with a `label`, arrows bound by `start` and `end`)
 * that Excalidraw expands, keeping the ids the author chose. A saved drawing
 * revised by hand mixes the two: only the skeletons are expanded.
 */
export function prepareScene(scene: ExcalidrawScene): PreparedScene {
  const savedElements = scene.elements.filter(isSavedSceneElement);
  const files = (scene.files ?? {}) as BinaryFiles;

  if (savedElements.length === scene.elements.length) {
    const restored = restore(
      scene as unknown as Parameters<typeof restore>[0],
      null,
      null,
    );

    return {
      elements: restored.elements as ExcalidrawElement[],
      appState: {
        viewBackgroundColor: readBackground(scene),
        frameRendering: SAVED_FRAME_RENDERING,
      },
      files: restored.files,
    };
  }

  // Saved elements go through conversion too, so a skeleton arrow can bind
  // to them, and are then swapped back for their restored originals, which
  // conversion would otherwise redraw from scratch. Each shape then lists
  // every arrow bound to it, saved or new.
  const restoredById = new Map(
    keepSavedBindings(
      restoreElements(
        savedElements as unknown as ExcalidrawElement[],
        null,
        { repairBindings: true },
      ),
      scene,
    ).map((element) => [element.id, element]),
  );
  const converted = convertToExcalidrawElements(
    readExpansionInput(scene) as unknown as ExcalidrawElementSkeleton[],
    { regenerateIds: false },
  );
  const elements = converted.map(
    (element) =>
      restoredById.get(element.id) ?? {
        ...element,
        seed: seedFromId(element.id),
      },
  );

  return {
    elements: listBoundArrows(placeInFrames(scene, elements, restoredById)),
    appState: {
      viewBackgroundColor: readBackground(scene),
      // An arrow between two frames belongs to neither, so nothing is cut
      // off at a frame's edge.
      frameRendering: { ...SAVED_FRAME_RENDERING, clip: false },
    },
    files,
  };
}

/** The scene as an `.excalidraw` file Excalidraw itself can open. */
export function serializeScene(scene: ExcalidrawScene): string {
  const { elements, appState, files } = prepareScene(scene);
  return serializeAsJSON(elements, appState, files, "local");
}

/**
 * Conversion pulls every arrow bound to a frame's child into that frame, so
 * an arrow between two frames stretches both. Membership follows the frame's
 * `children` list instead (a label follows its shape), and a frame the author
 * did not size is sized around its own members. Saved elements keep the
 * frame they were saved in unless a hand-written frame lists them.
 */
function placeInFrames(
  scene: ExcalidrawScene,
  elements: ExcalidrawElement[],
  savedById: ReadonlyMap<string, ExcalidrawElement>,
): ExcalidrawElement[] {
  const frameByChild = new Map<string, string>();
  const sizedFrames = new Map<string, ExcalidrawSceneElement>();

  for (const skeleton of scene.elements) {
    if (!isFrameElementType(skeleton.type) || isSavedSceneElement(skeleton)) {
      continue;
    }

    for (const child of (skeleton.children as string[] | undefined) ?? []) {
      frameByChild.set(child, skeleton.id);
    }

    if (typeof skeleton.width === "number" && typeof skeleton.height === "number") {
      sizedFrames.set(skeleton.id, skeleton);
    }
  }

  if (frameByChild.size === 0) {
    return elements;
  }

  const placed = elements.map((element) => {
    if (isFrameElementType(element.type)) {
      return element;
    }

    const owner =
      element.type === "text" && element.containerId
        ? element.containerId
        : element.id;
    const frameId =
      frameByChild.get(owner) ??
      (savedById.has(owner) ? element.frameId : null);

    return frameId === element.frameId ? element : { ...element, frameId };
  });

  return placed.map((element) => {
    if (!isFrameElementType(element.type) || savedById.has(element.id)) {
      return element;
    }

    // Conversion reads a 0 as "not given", so the author's own numbers win.
    const sized = sizedFrames.get(element.id);

    if (sized) {
      return {
        ...element,
        x: readNumber(sized.x, element.x),
        y: readNumber(sized.y, element.y),
        width: sized.width as number,
        height: sized.height as number,
      };
    }

    const members = placed.filter((member) => member.frameId === element.id);

    if (members.length === 0) {
      return element;
    }

    const bounds = unionBounds(
      members.map((member) => readElementBounds(member as CanvasElement)),
    );

    return {
      ...element,
      x: bounds.x - FRAME_PADDING,
      y: bounds.y - FRAME_PADDING,
      width: bounds.width + FRAME_PADDING * 2,
      height: bounds.height + FRAME_PADDING * 2,
    };
  });
}

/**
 * The seed shapes the hand-drawn wobble. Conversion picks a random one, so
 * deriving it from the id draws a version the same way on every load.
 */
function seedFromId(id: string): number {
  let hash = 2166136261;

  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }

  return (hash >>> 0) % 2147483647 || 1;
}

function readBackground(scene: ExcalidrawScene): string {
  return typeof scene.appState?.viewBackgroundColor === "string"
    ? scene.appState.viewBackgroundColor
    : "#ffffff";
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
