// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackBar } from "./FeedbackBar";

afterEach(cleanup);

describe("FeedbackBar", () => {
  it("opens pending feedback without submitting it", async () => {
    const onSubmit = vi.fn();
    const onViewPending = vi.fn();
    const user = userEvent.setup();

    render(
      <FeedbackBar
        commentCount={2}
        decisionCount={0}
        isPendingFeedbackOpen={false}
        isSubmitting={false}
        notice={null}
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

  it("does not offer pending navigation after submission", () => {
    render(
      <FeedbackBar
        commentCount={0}
        decisionCount={0}
        isPendingFeedbackOpen={false}
        isSubmitting={false}
        notice={{ kind: "success", message: "Feedback submitted." }}
        onSubmit={vi.fn()}
        onViewPending={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "View pending feedback" }),
    ).toBeNull();
    expect(screen.getByText("Feedback submitted.")).toBeTruthy();
  });
});
