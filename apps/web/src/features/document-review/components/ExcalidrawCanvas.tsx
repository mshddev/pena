import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import {
  isSavedSceneElement,
  type CanvasBounds,
  type ExcalidrawScene,
} from "@pena/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  readElementBounds,
  unionBounds,
  type CanvasElement,
  type CanvasViewport,
} from "../canvas-scene";
import { prepareScene } from "../excalidraw-elements";

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
    const next = prepareScene(scene);
    api.addFiles(Object.values(next.files));
    api.updateScene({ elements: next.elements, appState: next.appState });
  }, [scene]);

  // Excalidraw adds its fonts only once a scene has loaded, so a hand-written
  // scene is first laid out in a fallback font. When the fonts arrive it is
  // expanded again, which wraps and sizes every label in the real font.
  useEffect(() => {
    function handleFontsLoaded(): void {
      const scene = loadedSceneRef.current;

      if (apiRef.current && !scene.elements.every(isSavedSceneElement)) {
        apiRef.current.updateScene({ elements: prepareScene(scene).elements });
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
        createHandle(api).fit();
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

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
/** Space kept around the scene when it is fitted to the canvas, in pixels. */
const FIT_MARGIN = 32;

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
