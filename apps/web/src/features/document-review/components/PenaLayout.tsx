import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import type { OutlineSection } from "../outline";
import { DocumentOutline } from "./DocumentOutline";
import { ReviewBar } from "./ReviewBar";

const OUTLINE_WIDTH_STORAGE_KEY = "pena:outline-width";
// The older key was written on every visit, so it holds no real choice. This
// one is written only when the reader folds or opens the outline.
const OUTLINE_VISIBILITY_STORAGE_KEY = "pena:outline-open";
const LEGACY_OUTLINE_VISIBILITY_STORAGE_KEY = "pena:outline-visibility";
const MIN_OUTLINE_WIDTH = 214;
const MAX_OUTLINE_WIDTH = 420;
const OUTLINE_WIDTH_STEP = 12;

interface PenaLayoutProps {
  activeSectionId: string | null;
  /** The bar's content after the outline toggle. */
  bar: ReactNode;
  /** The document's name, shown on the bar's pull tab while it is hidden. */
  barTitle: string;
  children: ReactNode;
  /** The document is drawn in a frame (an HTML page). */
  hasFrame?: boolean;
  /** Keeps the bar in view while something in it is open. */
  isBarPinned?: boolean;
  sections: OutlineSection[];
}

export function PenaLayout({
  activeSectionId,
  bar,
  barTitle,
  children,
  hasFrame = false,
  isBarPinned = false,
  sections,
}: PenaLayoutProps) {
  const [outlineWidth, setOutlineWidth] = useState<number | null>(
    readSavedOutlineWidth,
  );
  const [isOutlineOpen, setIsOutlineOpen] = useState(
    readSavedOutlineVisibility,
  );
  const [isResizingOutline, setIsResizingOutline] = useState(false);
  const layoutRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  const renderedOutlineWidth =
    outlineWidth ?? readResponsiveOutlineWidth();
  const layoutStyle = outlineWidth === null
    ? undefined
    : ({
        "--outline-width": `${outlineWidth}px`,
      } as CSSProperties);

  useEffect(() => {
    try {
      if (outlineWidth === null) {
        window.localStorage.removeItem(OUTLINE_WIDTH_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          OUTLINE_WIDTH_STORAGE_KEY,
          String(outlineWidth),
        );
      }
    } catch {
      // Resizing still works when storage is unavailable.
    }
  }, [outlineWidth]);

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_OUTLINE_VISIBILITY_STORAGE_KEY);
    } catch {
      // Nothing to tidy when storage is unavailable.
    }
  }, []);

  function setOutlineOpen(isOpen: boolean): void {
    setIsOutlineOpen(isOpen);

    try {
      window.localStorage.setItem(
        OUTLINE_VISIBILITY_STORAGE_KEY,
        isOpen ? "open" : "closed",
      );
    } catch {
      // Folding still works when storage is unavailable.
    }
  }

  function handleResizeStart(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    const currentWidth =
      layoutRef.current
        ?.querySelector<HTMLElement>(".document-index")
        ?.getBoundingClientRect().width ?? renderedOutlineWidth;

    dragRef.current = {
      pointerId: event.pointerId,
      startWidth: currentWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    setIsResizingOutline(true);
  }

  function handleResizeMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setOutlineWidth(
      clampOutlineWidth(drag.startWidth + event.clientX - drag.startX),
    );
  }

  function handleResizeEnd(event: PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizingOutline(false);
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey
      ? OUTLINE_WIDTH_STEP * 2
      : OUTLINE_WIDTH_STEP;
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") {
      nextWidth = renderedOutlineWidth - step;
    } else if (event.key === "ArrowRight") {
      nextWidth = renderedOutlineWidth + step;
    } else if (event.key === "Home") {
      nextWidth = MIN_OUTLINE_WIDTH;
    } else if (event.key === "End") {
      nextWidth = MAX_OUTLINE_WIDTH;
    }

    if (nextWidth !== null) {
      event.preventDefault();
      setOutlineWidth(clampOutlineWidth(nextWidth));
    }
  }

  return (
    <div className="app-shell review-shell">
      <ReviewBar hasFrame={hasFrame} isPinned={isBarPinned} title={barTitle}>
        <button
          aria-controls="document-outline-panel"
          aria-expanded={isOutlineOpen}
          aria-label="Document outline"
          className="outline-toggle-button"
          onClick={() => setOutlineOpen(!isOutlineOpen)}
          title={isOutlineOpen ? "Hide outline" : "Show outline"}
          type="button"
        >
          <OutlineIcon />
        </button>
        {bar}
      </ReviewBar>

      <main
        className={`review-layout${isResizingOutline ? " resizing-outline" : ""}${
          isOutlineOpen ? "" : " outline-collapsed"
        }`}
        ref={layoutRef}
        style={layoutStyle}
      >
        <DocumentOutline
          activeSectionId={activeSectionId}
          isOpen={isOutlineOpen}
          onCollapse={() => setOutlineOpen(false)}
          sections={sections}
        />
        {isOutlineOpen ? (
          <div
            aria-label="Resize document outline"
            aria-orientation="vertical"
            aria-valuemax={MAX_OUTLINE_WIDTH}
            aria-valuemin={MIN_OUTLINE_WIDTH}
            aria-valuenow={Math.round(renderedOutlineWidth)}
            aria-valuetext={`${Math.round(renderedOutlineWidth)} pixels`}
            className="outline-resizer"
            onDoubleClick={() => setOutlineWidth(null)}
            onKeyDown={handleResizeKeyDown}
            onLostPointerCapture={handleResizeEnd}
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            role="separator"
            tabIndex={0}
            title="Drag to resize. Double-click to reset."
          />
        ) : null}
        {children}
      </main>
    </div>
  );
}

function clampOutlineWidth(width: number): number {
  return Math.round(
    Math.min(MAX_OUTLINE_WIDTH, Math.max(MIN_OUTLINE_WIDTH, width)),
  );
}

function readResponsiveOutlineWidth(): number {
  if (typeof window === "undefined") {
    return MIN_OUTLINE_WIDTH;
  }

  return Math.min(
    288,
    Math.max(MIN_OUTLINE_WIDTH, window.innerWidth * 0.21),
  );
}

function readSavedOutlineWidth(): number | null {
  try {
    const savedWidth = Number(
      window.localStorage.getItem(OUTLINE_WIDTH_STORAGE_KEY),
    );

    return Number.isFinite(savedWidth) && savedWidth > 0
      ? clampOutlineWidth(savedWidth)
      : null;
  } catch {
    return null;
  }
}

/** The outline starts folded so the document gets the width. */
function readSavedOutlineVisibility(): boolean {
  try {
    return window.localStorage.getItem(OUTLINE_VISIBILITY_STORAGE_KEY) === "open";
  } catch {
    return false;
  }
}

function OutlineIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M3 3h10v10H3zM7 3v10" />
    </svg>
  );
}
