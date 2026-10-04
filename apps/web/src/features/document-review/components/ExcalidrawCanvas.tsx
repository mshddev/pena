import {
  Excalidraw,
  convertToExcalidrawElements,
  restore,
  restoreElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { CanvasBounds, ExcalidrawScene } from "@pena/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  readElementBounds,
  unionBounds,
  type CanvasElement,
  type CanvasViewport,
} from "../canvas-scene";

/** What the review page may ask of the canvas. */
export interface CanvasHandle {
  getElements: () => readonly CanvasElement[];
  getViewport: () => CanvasViewport;
  /** Scrolls `bounds` into the middle of the canvas, zooming to fit if asked. */
  showBounds: (bounds: CanvasBounds, options: { fit: boolean }) => void;
  /** Shows the whole scene, at no more than its actual size. */
  fit: () => void;
  /** Zooms by `factor` around the middle of the canvas. */
  zoomBy: (factor: number) => void;
}

interface ExcalidrawCanvasProps {
  scene: ExcalidrawScene;
  onReady?: (handle: CanvasHandle) => void;
  /** Runs whenever the elements change: loaded, re-measured, or republished. */
  onSceneChange?: () => void;
  onViewportChange?: (viewport: CanvasViewport) => void;
}

/**
 * The scene in Excalidraw's view mode: the reader can pan and zoom but not
 * edit. Pena draws its own comment layer over it.
 */
export default function ExcalidrawCanvas({
  scene,
  onReady,
  onSceneChange,
  onViewportChange,
}: ExcalidrawCanvasProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const loadedSceneRef = useRef(scene);
  const seenElementsRef = useRef<readonly ExcalidrawElement[] | null>(null);
  const hasFittedRef = useRef(false);
  const canvasSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [initialData] = useState(() => prepareScene(scene));
  const callbacksRef = useRef({ onSceneChange, onViewportChange });

  useEffect(() => {
    callbacksRef.current = { onSceneChange, onViewportChange };
  });

  // A republished version replaces the elements and keeps the reader's view.
  useEffect(() => {
    const api = apiRef.current;

    if (!api || loadedSceneRef.current === scene) {
      return;
    }

    loadedSceneRef.current = scene;
    api.updateScene({ elements: prepareScene(scene).elements });
    remeasureText(api);
  }, [scene]);

  // Text is measured with whatever font has loaded, so it is measured again
  // once Excalidraw's own fonts arrive.
  useEffect(() => {
    function handleFontsLoaded(): void {
      if (apiRef.current) {
        remeasureText(apiRef.current);
      }
    }

    window.document.fonts?.addEventListener("loadingdone", handleFontsLoaded);
    return () =>
      window.document.fonts?.removeEventListener(
        "loadingdone",
        handleFontsLoaded,
      );
  }, []);

  const handleApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      onReady?.(createHandle(api));
    },
    [onReady],
  );

  // Excalidraw loads the scene after handing over its API, so the first
  // change with elements is the scene arriving.
  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      const api = apiRef.current;

      if (!api) {
        return;
      }

      // Excalidraw keeps the top-left corner when the canvas is resized, as
      // when the pending feedback panel opens; the reader expects the middle
      // to stay put.
      const size = canvasSizeRef.current;
      canvasSizeRef.current = { width: appState.width, height: appState.height };

      if (
        size &&
        hasFittedRef.current &&
        (size.width !== appState.width || size.height !== appState.height)
      ) {
        const zoom = appState.zoom.value;

        api.updateScene({
          appState: {
            scrollX: appState.scrollX + (appState.width - size.width) / (2 * zoom),
            scrollY:
              appState.scrollY + (appState.height - size.height) / (2 * zoom),
          },
        });
      }

      if (elements === seenElementsRef.current) {
        return;
      }

      seenElementsRef.current = elements;

      if (!hasFittedRef.current && elements.length > 0) {
        hasFittedRef.current = true;
        remeasureText(api);
        createHandle(api).fit();
        return;
      }

      callbacksRef.current.onSceneChange?.();
    },
    [],
  );

  const handleScroll = useCallback(
    (scrollX: number, scrollY: number, zoom: AppState["zoom"]) => {
      callbacksRef.current.onViewportChange?.({
        scrollX,
        scrollY,
        zoom: zoom.value,
      });
    },
    [],
  );

  return (
    <Excalidraw
      excalidrawAPI={handleApi}
      initialData={initialData}
      onChange={handleChange}
      onScrollChange={handleScroll}
      viewModeEnabled
      zenModeEnabled
      gridModeEnabled={false}
      theme="light"
      handleKeyboardGlobally={false}
      autoFocus={false}
      detectScroll={false}
      UIOptions={{
        canvasActions: {
          changeViewBackgroundColor: false,
          clearCanvas: false,
          export: false,
          loadScene: false,
          saveAsImage: false,
          saveToActiveFile: false,
          toggleTheme: null,
        },
      }}
    />
  );
}

/**
 * A scene saved by Excalidraw loads as it is. One written by hand is a list
 * of skeletons (shapes with a `label`, arrows bound by `start` and `end`),
 * which Excalidraw expands into elements, keeping the ids the author chose.
 */
function prepareScene(scene: ExcalidrawScene): ExcalidrawInitialDataState {
  if (scene.elements.every(isSavedElement)) {
    return restoreScene(scene);
  }

  let elements: ExcalidrawElement[];

  try {
    elements = convertToExcalidrawElements(
      scene.elements as unknown as ExcalidrawElementSkeleton[],
      { regenerateIds: false },
    ).map((element) => ({ ...element, seed: seedFromId(element.id) }));
  } catch (conversionError) {
    // Elements that are neither skeletons nor saved may still restore,
    // which beats showing nothing; if not, the conversion error says why.
    try {
      return restoreScene(scene);
    } catch {
      throw conversionError;
    }
  }

  return {
    elements: placeInFrames(scene, elements),
    appState: {
      viewBackgroundColor: readBackground(scene),
      // An arrow between two frames belongs to neither, so nothing is cut
      // off at a frame's edge.
      frameRendering: { enabled: true, name: true, outline: true, clip: false },
    },
    files: (scene.files ?? {}) as ExcalidrawInitialDataState["files"],
  };
}

function restoreScene(scene: ExcalidrawScene): ExcalidrawInitialDataState {
  const restored = restore(
    scene as unknown as Parameters<typeof restore>[0],
    null,
    null,
  );

  return {
    elements: restored.elements,
    appState: { viewBackgroundColor: readBackground(scene) },
    files: restored.files,
  };
}

function readBackground(scene: ExcalidrawScene): string {
  return typeof scene.appState?.viewBackgroundColor === "string"
    ? scene.appState.viewBackgroundColor
    : "#ffffff";
}

const FRAME_TYPES = new Set(["frame", "magicframe"]);
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
/** Space kept around the scene when it is fitted to the canvas, in pixels. */
const FIT_MARGIN = 32;
/** Room around a frame's members, enough for text that widens on re-measure. */
const FRAME_PADDING = 24;

/**
 * Conversion pulls every arrow bound to a frame's child into that frame, so
 * an arrow between two frames stretches both. Membership follows the frame's
 * `children` list instead (a label follows its shape), and a frame the author
 * did not size is sized around its own members.
 */
function placeInFrames(
  scene: ExcalidrawScene,
  elements: ExcalidrawElement[],
): ExcalidrawElement[] {
  const frameByChild = new Map<string, string>();
  const sizedFrames = new Set<string>();

  for (const skeleton of scene.elements) {
    if (!FRAME_TYPES.has(skeleton.type)) {
      continue;
    }

    if (Array.isArray(skeleton.children)) {
      for (const child of skeleton.children) {
        if (typeof child === "string") {
          frameByChild.set(child, skeleton.id);
        }
      }
    }

    if (typeof skeleton.width === "number" && typeof skeleton.height === "number") {
      sizedFrames.add(skeleton.id);
    }
  }

  if (frameByChild.size === 0) {
    return elements;
  }

  const placed = elements.map((element) => {
    if (FRAME_TYPES.has(element.type)) {
      return element;
    }

    const owner =
      element.type === "text" && element.containerId
        ? element.containerId
        : element.id;

    return { ...element, frameId: frameByChild.get(owner) ?? null };
  });

  return placed.map((element) => {
    if (!FRAME_TYPES.has(element.type) || sizedFrames.has(element.id)) {
      return element;
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

/** Excalidraw writes a seed and a version on every element it saves. */
function isSavedElement(element: ExcalidrawScene["elements"][number]): boolean {
  return typeof element.seed === "number" && typeof element.version === "number";
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

function remeasureText(api: ExcalidrawImperativeAPI): void {
  api.updateScene({
    elements: restoreElements(api.getSceneElements(), null, {
      refreshDimensions: true,
      repairBindings: true,
    }),
  });
}

function createHandle(api: ExcalidrawImperativeAPI): CanvasHandle {
  function setCamera(zoom: number, center: { x: number; y: number }): void {
    const appState = api.getAppState();
    const value = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);

    api.updateScene({
      appState: {
        zoom: { value: value as AppState["zoom"]["value"] },
        scrollX: appState.width / (2 * value) - center.x,
        scrollY: appState.height / (2 * value) - center.y,
      },
    });
  }

  function showBounds(bounds: CanvasBounds, { fit }: { fit: boolean }): void {
    const appState = api.getAppState();
    const zoom = fit
      ? Math.min(
          ((appState.width - FIT_MARGIN * 2) / Math.max(bounds.width, 1)),
          ((appState.height - FIT_MARGIN * 2) / Math.max(bounds.height, 1)),
          1,
        )
      : appState.zoom.value;

    setCamera(zoom, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
  }

  return {
    getElements: () => api.getSceneElements() as readonly CanvasElement[],
    getViewport: () => {
      const appState = api.getAppState();
      return {
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
      };
    },
    showBounds,
    fit: () => {
      const elements = api.getSceneElements();

      if (elements.length > 0) {
        showBounds(
          unionBounds(
            elements.map((element) =>
              readElementBounds(element as CanvasElement),
            ),
          ),
          { fit: true },
        );
      }
    },
    zoomBy: (factor) => {
      const appState = api.getAppState();
      const zoom = appState.zoom.value;

      setCamera(zoom * factor, {
        x: appState.width / (2 * zoom) - appState.scrollX,
        y: appState.height / (2 * zoom) - appState.scrollY,
      });
    },
  };
}
