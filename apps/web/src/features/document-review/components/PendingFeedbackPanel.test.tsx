// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DraftComment,
  DraftDecision,
} from "../types";
import { PendingFeedbackPanel } from "./PendingFeedbackPanel";

const comment: DraftComment = {
  kind: "comment",
  id: "comment-1",
  selectedText: "Cache repeated reads for five minutes.",
  comment: "Make the TTL configurable.",
  contextBefore: "",
  contextAfter: "",
  anchorId: "segment-0-p-0",
  anchorOffset: 0,
};

const decision: DraftDecision = {
  kind: "decision",
  id: "decision:request-cache",
  decisionId: "request-cache",
  choice: "Apply",
  selectedText: "Add request caching",
  comment: "[decision:request-cache] Apply",
  contextBefore: "",
  contextAfter: "",
};

afterEach(cleanup);

describe("PendingFeedbackPanel", () => {
  it("shows pending details and activates comments and decisions", async () => {
    const onActivateComment = vi.fn();
    const onActivateDecision = vi.fn();
    const user = userEvent.setup();
    render(
      <PendingFeedbackPanel
        feedback={[comment, decision]}
        onActivateComment={onActivateComment}
        onActivateDecision={onActivateDecision}
        onClose={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "Pending feedback" }),
    ).toBeTruthy();
    expect(screen.getByText("Make the TTL configurable.")).toBeTruthy();
    expect(screen.getByText("Apply")).toBeTruthy();

    await user.click(
      screen.getByRole("button", {
        name: /Cache repeated reads for five minutes/,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Add request caching/ }),
    );

    expect(onActivateComment).toHaveBeenCalledWith(comment);
    expect(onActivateDecision).toHaveBeenCalledWith("request-cache");
  });

  it("removes an individual pending item", async () => {
    const onClose = vi.fn();
    const onRemove = vi.fn();
    const user = userEvent.setup();

    render(
      <PendingFeedbackPanel
        feedback={[comment, decision]}
        onActivateComment={vi.fn()}
        onActivateDecision={vi.fn()}
        onClose={onClose}
        onRemove={onRemove}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Hide pending feedback" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove comment 1" }),
    );

    expect(onClose).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith(comment);
  });
});
