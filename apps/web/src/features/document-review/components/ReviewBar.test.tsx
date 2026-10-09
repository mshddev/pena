// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVIEW_BAR_HIDE_DELAY_MS, ReviewBar } from "./ReviewBar";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderBar(isPinned = false) {
  return render(
    <ReviewBar isPinned={isPinned} title="Checkout flow">
      <button type="button">Edit</button>
    </ReviewBar>,
  );
}

function bar(): HTMLElement {
  return screen.getByRole("banner");
}

function waitOutDelay(): void {
  act(() => {
    vi.advanceTimersByTime(REVIEW_BAR_HIDE_DELAY_MS);
  });
}

describe("ReviewBar", () => {
  it("shows on arrival, then slides away and leaves a pull tab", () => {
    renderBar();

    expect(bar().className).not.toContain("is-hidden");
    expect(screen.queryByRole("button", { name: "Show document bar" })).toBeNull();

    waitOutDelay();

    expect(bar().className).toContain("is-hidden");
    const tab = screen.getByRole("button", { name: "Show document bar" });
    expect(tab.textContent).toContain("Checkout flow");

    fireEvent.click(tab);

    expect(bar().className).not.toContain("is-hidden");
  });

  it("stays while the pointer is on it and hides once it leaves", () => {
    renderBar();

    fireEvent.pointerEnter(bar());
    waitOutDelay();
    expect(bar().className).not.toContain("is-hidden");

    fireEvent.pointerLeave(bar());
    act(() => {
      vi.advanceTimersByTime(REVIEW_BAR_HIDE_DELAY_MS - 1);
    });
    expect(bar().className).not.toContain("is-hidden");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(bar().className).toContain("is-hidden");
  });

  it("comes back when the pointer reaches the top edge", () => {
    const { container } = renderBar();

    waitOutDelay();
    const zone = container.ownerDocument.querySelector(
      ".review-bar-reveal-zone",
    ) as HTMLElement;
    fireEvent.pointerEnter(zone);

    expect(bar().className).not.toContain("is-hidden");
    // Reaching the edge without moving onto the bar hides it again.
    waitOutDelay();
    expect(bar().className).toContain("is-hidden");
  });

  it("comes back when focus moves into it", () => {
    renderBar();

    waitOutDelay();
    act(() => {
      screen.getByRole("button", { name: "Edit" }).focus();
    });

    expect(bar().className).not.toContain("is-hidden");
  });

  it("stays in view while pinned", () => {
    const { rerender } = renderBar(true);

    waitOutDelay();
    expect(bar().className).not.toContain("is-hidden");

    rerender(
      <ReviewBar isPinned={false} title="Checkout flow">
        <button type="button">Edit</button>
      </ReviewBar>,
    );
    waitOutDelay();
    expect(bar().className).toContain("is-hidden");
  });
});
