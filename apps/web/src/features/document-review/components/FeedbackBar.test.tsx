// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackBar } from "./FeedbackBar";

afterEach(cleanup);

describe("FeedbackBar", () => {
  it("keeps the full submit widget visible while idle", async () => {
    const onInstructionComposerOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <FeedbackBar
        commentCount={0}
        decisionCount={0}
        instruction=""
        isInstructionComposerOpen={false}
        isPendingFeedbackOpen={false}
        isSubmitting={false}
        notice={null}
        onInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={onInstructionComposerOpenChange}
        onSubmit={vi.fn()}
        onViewPending={vi.fn()}
      />,
    );

    expect(screen.getByText("No feedback drafted")).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Submit feedback",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Add instruction" }));
    expect(onInstructionComposerOpenChange).toHaveBeenCalledWith(true);
  });

  it("opens pending feedback without submitting it", async () => {
    const onSubmit = vi.fn();
    const onViewPending = vi.fn();
    const user = userEvent.setup();

    render(
      <FeedbackBar
        commentCount={2}
        decisionCount={0}
        instruction=""
        isInstructionComposerOpen={false}
        isPendingFeedbackOpen={false}
        isSubmitting={false}
        notice={null}
        onInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={vi.fn()}
        onSubmit={onSubmit}
        onViewPending={onViewPending}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "View pending feedback" }),
    );

    expect(
      screen
        .getByRole("button", { name: "View pending feedback" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(onViewPending).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("minimizes to the bottom-right feedback control and restores", async () => {
    const user = userEvent.setup();

    render(
      <FeedbackBar
        commentCount={2}
        decisionCount={0}
        instruction=""
        isInstructionComposerOpen={false}
        isPendingFeedbackOpen={true}
        isSubmitting={false}
        notice={null}
        onInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        onViewPending={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Minimize feedback widget" }),
    );

    const expand = screen.getByRole("button", {
      name: "Expand feedback widget, 2 pending items",
    });
    expect(expand.querySelector(".feedback-widget-badge")?.textContent).toBe(
      "2",
    );
    expect(
      screen.queryByRole("button", { name: "Submit feedback" }),
    ).toBeNull();

    await user.click(expand);
    expect(
      screen.getByRole("button", { name: "Submit feedback" }),
    ).toBeTruthy();
  });

  it("does not offer pending navigation after submission", () => {
    render(
      <FeedbackBar
        commentCount={0}
        decisionCount={0}
        instruction=""
        isInstructionComposerOpen={false}
        isPendingFeedbackOpen={false}
        isSubmitting={false}
        notice={{ kind: "success", message: "Feedback submitted." }}
        onInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        onViewPending={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "View pending feedback" }),
    ).toBeNull();
    expect(screen.getByText("Feedback submitted.")).toBeTruthy();
  });

  it("submits an overall instruction without comments", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <FeedbackBar
        commentCount={0}
        decisionCount={0}
        instruction="Keep the API unchanged."
        isInstructionComposerOpen={false}
        isPendingFeedbackOpen={true}
        isSubmitting={false}
        notice={null}
        onInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={vi.fn()}
        onSubmit={onSubmit}
        onViewPending={vi.fn()}
      />,
    );

    expect(screen.getByText("overall instruction")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("opens the instruction editor inside the submit widget", async () => {
    const onInstructionComposerOpenChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FeedbackBar
        commentCount={1}
        decisionCount={0}
        instruction=""
        isInstructionComposerOpen={false}
        isPendingFeedbackOpen={true}
        isSubmitting={false}
        notice={null}
        onInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={onInstructionComposerOpenChange}
        onSubmit={vi.fn()}
        onViewPending={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add instruction" }));
    expect(onInstructionComposerOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <FeedbackBar
        commentCount={1}
        decisionCount={0}
        instruction=""
        isInstructionComposerOpen={true}
        isPendingFeedbackOpen={true}
        isSubmitting={false}
        notice={null}
        onInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={onInstructionComposerOpenChange}
        onSubmit={vi.fn()}
        onViewPending={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Overall instruction" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("contentinfo", { name: "Draft feedback" })
        .querySelector(".feedback-instruction-composer"),
    ).toBeTruthy();
  });
});
