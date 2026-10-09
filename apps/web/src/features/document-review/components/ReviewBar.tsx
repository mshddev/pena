import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";

/** How long the bar stays after the pointer leaves the top of the window. */
export const REVIEW_BAR_HIDE_DELAY_MS = 2000;
/** How close to the top edge the pointer brings a hidden bar back. */
const REVEAL_EDGE = 16;

interface ReviewBarProps {
  children: ReactNode;
  /** Keeps the bar in view, for example while one of its menus is open. */
  isPinned: boolean;
  /** Shown on the pull tab while the bar is hidden. */
  title: string;
}

/**
 * The review page's only chrome. It floats over the document and slides away
 * a moment after the pointer leaves it, so the document gets the window. The
 * pointer reaching the top edge, the pull tab, or keyboard focus brings it
 * back.
 *
 * Leaving is read off the bar itself. Arriving is read off the window's
 * pointer moves, except while the pointer is over an HTML page's frame,
 * which keeps them; only then a strip over the top edge watches instead, at
 * the cost of clicks on the frame's top 16 pixels.
 */
export function ReviewBar({ children, isPinned, title }: ReviewBarProps) {
  const [isHidden, setIsHidden] = useState(false);
  const [isPointerOverFrame, setIsPointerOverFrame] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const isHoveredRef = useRef(false);
  const isPinnedRef = useRef(isPinned);
  const isHiddenRef = useRef(isHidden);
  const tabPointerTypeRef = useRef("mouse");
  const isShown = isPinned || !isHidden;

  useEffect(() => {
    isHiddenRef.current = isHidden;
  }, [isHidden]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;

      if (
        isPinnedRef.current ||
        isHoveredRef.current ||
        hasKeyboardFocus(barRef.current)
      ) {
        return;
      }

      setIsHidden(true);
    }, REVIEW_BAR_HIDE_DELAY_MS);
  }, [cancelHide]);

  const reveal = useCallback(() => {
    cancelHide();
    setIsHidden(false);
  }, [cancelHide]);

  // The bar shows on arrival and counts down from there, so a reader who
  // never reaches for it still sees where it lives.
  useEffect(() => {
    isPinnedRef.current = isPinned;

    if (isPinned) {
      reveal();
    } else if (!isHoveredRef.current) {
      scheduleHide();
    }
  }, [isPinned, reveal, scheduleHide]);

  useEffect(() => cancelHide, [cancelHide]);

  // A finger never leaves the bar the way a mouse does, so a tap elsewhere
  // counts as leaving.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (
        event.pointerType === "mouse" ||
        isPinnedRef.current ||
        barRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      scheduleHide();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [scheduleHide]);

  // A canvas or a Markdown page lets pointer moves through, so the top edge
  // needs no strip that would take the clicks meant for the document.
  useEffect(() => {
    function handlePointerMove(event: PointerEvent): void {
      if (isHiddenRef.current && event.clientY <= REVEAL_EDGE) {
        reveal();
        scheduleHide();
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [reveal, scheduleHide]);

  // The frame element belongs to this page, so crossing its edge is seen
  // here even though the moves inside it are not.
  useEffect(() => {
    function handlePointerOver(event: PointerEvent): void {
      setIsPointerOverFrame(event.target instanceof HTMLIFrameElement);
    }

    window.addEventListener("pointerover", handlePointerOver);
    return () => window.removeEventListener("pointerover", handlePointerOver);
  }, []);

  function handleBlur(event: FocusEvent<HTMLElement>): void {
    if (
      !isPinnedRef.current &&
      !isHoveredRef.current &&
      !event.currentTarget.contains(event.relatedTarget as Node | null)
    ) {
      scheduleHide();
    }
  }

  return (
    <>
      <header
        className={`review-bar${isShown ? "" : " is-hidden"}`}
        ref={barRef}
        onPointerEnter={() => {
          isHoveredRef.current = true;
          reveal();
        }}
        onPointerLeave={() => {
          isHoveredRef.current = false;

          if (!isPinnedRef.current) {
            scheduleHide();
          }
        }}
        onFocus={reveal}
        onBlur={handleBlur}
      >
        {children}
      </header>

      {isShown ? null : (
        <>
          {isPointerOverFrame ? (
            <div
              aria-hidden="true"
              className="review-bar-reveal-zone"
              onPointerEnter={() => {
                reveal();
                scheduleHide();
              }}
            />
          ) : null}
          {/* Keyboard focus reaches the bar itself, so the tab is for the
              pointer only. */}
          <button
            aria-label="Show document bar"
            className="review-bar-tab"
            onPointerDown={(event) => {
              tabPointerTypeRef.current = event.pointerType;
            }}
            onClick={() => {
              reveal();

              // A mouse leaving the bar starts the countdown; a finger never
              // leaves it, so the tap starts it.
              if (tabPointerTypeRef.current !== "mouse") {
                scheduleHide();
              }
            }}
            tabIndex={-1}
            title="Show document bar"
            type="button"
          >
            <span>{title}</span>
            <RevealIcon />
          </button>
        </>
      )}
    </>
  );
}

/** Focus a mouse click left behind does not hold the bar open. */
function hasKeyboardFocus(bar: HTMLElement | null): boolean {
  const active = window.document.activeElement;

  if (!bar || !active || !bar.contains(active)) {
    return false;
  }

  try {
    return active.matches(":focus-visible");
  } catch {
    return true;
  }
}

function RevealIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m5 6.5 3 3 3-3" />
    </svg>
  );
}
