import { useId, useRef, type MouseEvent, type ReactNode } from "react";

import { useDismiss } from "../../../use-dismiss";

interface OverflowMenuProps {
  children: ReactNode;
  isOpen: boolean;
  label: string;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * A ⋯ button that discloses a short list of buttons and links. Choosing one,
 * pressing Escape, or clicking anywhere else, a page's frame included,
 * closes it.
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

  useDismiss({
    isOpen,
    onDismiss: () => onOpenChange(false),
    isInside: (target) => rootRef.current?.contains(target) ?? false,
    returnFocusTo: triggerRef,
    closeOnFrameClick: true,
  });

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
