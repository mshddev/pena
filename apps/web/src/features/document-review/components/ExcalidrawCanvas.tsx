import {
  Excalidraw,
  FONT_FAMILY,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
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
  /** The scene as it is now, in the `.excalidraw` form Pena stores. */
  toContent: () => string;
  /** Changes whenever any element changes; cheap enough to read often. */
  readSceneVersion: () => string;
}

interface ExcalidrawCanvasProps {
  scene: ExcalidrawScene;
  /** Shows Excalidraw's tools so the reader can change the scene. */
  editable?: boolean;
  onReady?: (handle: CanvasHandle) => void;
  /** Runs whenever the elements change: loaded, re-measured, or republished. */
  onSceneChange?: () => void;
  onViewportChange?: (viewport: CanvasViewport) => void;
}

/**
 * The scene in Excalidraw's view mode: the reader can pan and zoom but not
 * edit. Pena draws its own comment layer over it. An `editable` canvas is
 * Excalidraw's full editor instead.
 */
export default function ExcalidrawCanvas({
  scene,
  editable = false,
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
  const editableRef = useRef(editable);
  // The scene as Pena last laid it out. An editable scene that differs has
  // the reader's changes, which a re-layout must not throw away.
  const laidOutVersionRef = useRef<string | null>(null);

  useEffect(() => {
    callbacksRef.current = { onSceneChange, onViewportChange };
    editableRef.current = editable;
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
    laidOutVersionRef.current = readSceneVersion(api.getSceneElements());
  }, [scene]);

  // Excalidraw adds its fonts only once a scene has loaded, so a hand-written
  // scene is first laid out in a fallback font. When one of its fonts
  // arrives the scene is expanded again, once per burst of loads, which
  // wraps and sizes every label in the real font.
  useEffect(() => {
    let frame: number | null = null;

    function handleFontsLoaded(event: Event): void {
      const faces = (event as FontFaceSetLoadEvent).fontfaces ?? [];
      const scene = loadedSceneRef.current;

      if (
        frame !== null ||
        scene.elements.every(isSavedSceneElement) ||
        !faces.some((face) => SCENE_FONT_FAMILIES.has(unquote(face.family)))
      ) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = null;
        const api = apiRef.current;

        if (
          !api ||
          (editableRef.current &&
            readSceneVersion(api.getSceneElements()) !==
              laidOutVersionRef.current)
        ) {
          return;
        }

        api.updateScene({
          elements: prepareScene(loadedSceneRef.current).elements,
        });
        laidOutVersionRef.current = readSceneVersion(api.getSceneElements());
      });
    }

    window.document.fonts?.addEventListener("loadingdone", handleFontsLoaded);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      window.document.fonts?.removeEventListener(
        "loadingdone",
        handleFontsLoaded,
      );
    };
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
        laidOutVersionRef.current = readSceneVersion(elements);
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
      viewModeEnabled={!editable}
      zenModeEnabled={!editable}
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

function readSceneVersion(elements: readonly ExcalidrawElement[]): string {
  return elements.map((element) => `${element.id}:${element.version}`).join();
}

/** The families scene text is drawn in, with the fallback for CJK text. */
const SCENE_FONT_FAMILIES = new Set([...Object.keys(FONT_FAMILY), "Xiaolai"]);

function unquote(family: string): string {
  return family.replace(/^["']|["']$/g, "");
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
    toContent: () =>
      serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        "local",
      ),
    readSceneVersion: () => readSceneVersion(api.getSceneElements()),
  };
}
