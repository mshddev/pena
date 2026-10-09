// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDismiss } from "./use-dismiss";

afterEach(() => {
  cleanup();
});

function Popup({ onDismiss }: { onDismiss: () => void }) {
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useDismiss({
    isOpen: true,
    onDismiss,
    isInside: (target) => popupRef.current?.contains(target) ?? false,
    returnFocusTo: triggerRef,
    closeOnFrameClick: true,
  });

  return (
    <>
      <button ref={triggerRef} type="button">
        Trigger
      </button>
      <div ref={popupRef}>
        <button type="button">Inside</button>
      </div>
      <iframe title="Page" />
      <p>Outside</p>
    </>
  );
}

describe("useDismiss", () => {
  it("closes on a press outside, not inside", () => {
    const onDismiss = vi.fn();
    render(<Popup onDismiss={onDismiss} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Inside" }));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus", () => {
    const onDismiss = vi.fn();
    render(<Popup onDismiss={onDismiss} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Trigger" }),
    );
  });

  it("closes on a click in a frame, not on a frame's script taking focus", () => {
    const onDismiss = vi.fn();
    render(<Popup onDismiss={onDismiss} />);
    const frame = screen.getByTitle("Page");

    // A script moves focus into the frame while the pointer is elsewhere.
    fireEvent.pointerOver(screen.getByText("Outside"));
    frame.focus();
    fireEvent.blur(window);
    expect(onDismiss).not.toHaveBeenCalled();

    // The pointer crosses into the frame and the reader clicks there.
    fireEvent.pointerOver(frame);
    fireEvent.blur(window);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays open when the window loses focus to another app", () => {
    const onDismiss = vi.fn();
    render(<Popup onDismiss={onDismiss} />);

    // The pointer left through the frame, so the page never saw it go.
    fireEvent.pointerOver(screen.getByTitle("Page"));
    screen.getByRole("button", { name: "Inside" }).focus();
    fireEvent.blur(window);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
