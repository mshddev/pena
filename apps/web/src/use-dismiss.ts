import { useEffect, useRef, type RefObject } from "react";

interface DismissOptions {
  /** Listens only while this is true. */
  isOpen: boolean;
  onDismiss: () => void;
  /** Whether a pointer press on `target` counts as inside the popup. */
  isInside: (target: Element) => boolean;
  /** Where focus goes back to when Escape closes the popup. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /**
   * Also closes on a click inside a frame, which reaches the page only as
   * the window losing focus to that frame. A frame's own script taking focus
   * is not a click, and switching apps leaves focus where it was, so this
   * closes only when focus went to a frame while the pointer was over one.
   */
  closeOnFrameClick?: boolean;
}

/**
 * Closes a menu or popup on a pointer press outside it, or on Escape. Every
 * popup in the app dismisses through this, so they all behave alike.
 */
export function useDismiss({
  isOpen,
  onDismiss,
  isInside,
  returnFocusTo,
  closeOnFrameClick = false,
}: DismissOptions): void {
  const latestRef = useRef({ onDismiss, isInside, returnFocusTo });

  useEffect(() => {
    latestRef.current = { onDismiss, isInside, returnFocusTo };
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isPointerOverFrame = false;

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;

      if (!(target instanceof Element) || !latestRef.current.isInside(target)) {
        latestRef.current.onDismiss();
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        latestRef.current.onDismiss();
        latestRef.current.returnFocusTo?.current?.focus();
      }
    }

    // The frame element belongs to this page, so crossing its edge is seen
    // here even though what happens inside it is not.
    function handlePointerOver(event: PointerEvent): void {
      isPointerOverFrame = event.target instanceof HTMLIFrameElement;
    }

    function handleBlur(): void {
      if (
        isPointerOverFrame &&
        window.document.activeElement instanceof HTMLIFrameElement
      ) {
        latestRef.current.onDismiss();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    if (closeOnFrameClick) {
      window.addEventListener("pointerover", handlePointerOver);
      window.addEventListener("blur", handleBlur);
    }

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerover", handlePointerOver);
      window.removeEventListener("blur", handleBlur);
    };
  }, [isOpen, closeOnFrameClick]);
}
