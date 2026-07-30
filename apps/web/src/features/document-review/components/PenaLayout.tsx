import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { UtilityBar } from "../../../components/UtilityBar";

import type { OutlineSection } from "../outline";
import { DocumentOutline } from "./DocumentOutline";

const OUTLINE_WIDTH_STORAGE_KEY = "pena:outline-width";
const OUTLINE_VISIBILITY_STORAGE_KEY = "pena:outline-visibility";
const MIN_OUTLINE_WIDTH = 214;
const MAX_OUTLINE_WIDTH = 420;
const OUTLINE_WIDTH_STEP = 12;

interface PenaLayoutProps {
  activeSectionId: string | null;
  children: ReactNode;
  sections: OutlineSection[];
  workspaceSlug: string | null;
}

export function PenaLayout({
  activeSectionId,
  children,
  sections,
  workspaceSlug,
}: PenaLayoutProps) {
  const [outlineWidth, setOutlineWidth] = useState<number | null>(
    readSavedOutlineWidth,
  );
  const [isOutlineOpen, setIsOutlineOpen] = useState(
    readSavedOutlineVisibility,
  );
  const [isResizingOutline, setIsResizingOutline] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  const renderedOutlineWidth =
    outlineWidth ?? readResponsiveOutlineWidth();
  const workspaceStyle = outlineWidth === null
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
      window.localStorage.setItem(
        OUTLINE_VISIBILITY_STORAGE_KEY,
        isOutlineOpen ? "open" : "closed",
      );
    } catch {
      // Folding still works when storage is unavailable.
    }
  }, [isOutlineOpen]);

  function handleResizeStart(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    const currentWidth =
      workspaceRef.current
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
    <div className="app-shell">
      <UtilityBar current={null} workspaceSlug={workspaceSlug} />

      <main
        className={`workspace${isResizingOutline ? " resizing-outline" : ""}${
          isOutlineOpen ? "" : " outline-collapsed"
        }`}
        ref={workspaceRef}
        style={workspaceStyle}
      >
        <DocumentOutline
          activeSectionId={activeSectionId}
          isOpen={isOutlineOpen}
          onCollapse={() => setIsOutlineOpen(false)}
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
        ) : (
          <button
            aria-controls="document-outline-panel"
            aria-expanded="false"
            aria-label="Show document outline"
            className="outline-restore-button"
            onClick={() => setIsOutlineOpen(true)}
            title="Show document outline"
            type="button"
          >
            <ExpandOutlineIcon />
            <span>Outline</span>
          </button>
        )}
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

function readSavedOutlineVisibility(): boolean {
  try {
    return (
      window.localStorage.getItem(OUTLINE_VISIBILITY_STORAGE_KEY) !== "closed"
    );
  } catch {
    return true;
  }
}

function ExpandOutlineIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M3 3h10v10H3zM7 3v10M9 6l2 2-2 2" />
    </svg>
  );
}
