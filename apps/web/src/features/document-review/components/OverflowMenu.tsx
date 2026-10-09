import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";

interface OverflowMenuProps {
  children: ReactNode;
  isOpen: boolean;
  label: string;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * A ⋯ button that discloses a short list of buttons and links. Choosing one,
 * pressing Escape, or clicking anywhere else closes it.
 */
export function OverflowMenu({
  children,
  isOpen,
  label,
  onOpenChange,
}: OverflowMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    }

    // A click inside an HTML page's frame reaches the window only as blur.
    function handleBlur(): void {
      onOpenChange(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
    };
  }, [isOpen, onOpenChange]);

  function handlePanelClick(event: MouseEvent<HTMLDivElement>): void {
    if ((event.target as Element).closest("a, button:not(:disabled)")) {
      onOpenChange(false);
    }
  }

  return (
    <div className="overflow-menu" ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-label={label}
        className="overflow-menu-trigger"
        onClick={() => onOpenChange(!isOpen)}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <MoreIcon />
      </button>

      {isOpen ? (
        <div
          className="overflow-menu-panel"
          id={panelId}
          onClick={handlePanelClick}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="3.5" cy="8" r="0.9" />
      <circle cx="8" cy="8" r="0.9" />
      <circle cx="12.5" cy="8" r="0.9" />
    </svg>
  );
}
