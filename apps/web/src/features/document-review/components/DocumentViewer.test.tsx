// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentViewer } from "./DocumentViewer";

const document = {
  workspaceSlug: "default",
  slug: "highlight-test",
  title: "Highlight Test",
  content: "## Heading\n\nSelected passage.",
  version: 1,
  updatedAt: "2026-07-20T10:00:00.000Z",
  archivedAt: null,
};

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("CSS", {
    escape: (value: string) => value,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: vi.fn(() => []),
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => new DOMRect()),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Range.prototype as Partial<Range>).getClientRects;
  delete (Range.prototype as Partial<Range>).getBoundingClientRect;
});

describe("DocumentViewer", () => {
  it("preserves Markdown text nodes across feedback rerenders", () => {
    const props: ComponentProps<typeof DocumentViewer> = {
      document,
      draftFeedback: [],
      isPendingFeedbackOpen: true,
      submittedDecisions: {},
      isSubmitting: false,
      notice: null,
      onDraftSaved: vi.fn(),
      onDraftDeleted: vi.fn(),
      onDecisionDraftChanged: vi.fn(),
      onNoticeClear: vi.fn(),
      onPendingFeedbackOpenChange: vi.fn(),
      onSubmitFeedback: vi.fn(),
      onOutlineChange: vi.fn(),
      onActiveSectionChange: vi.fn(),
    };
    const { rerender } = render(<DocumentViewer {...props} />);
    const passageBeforeRerender = screen.getByText("Selected passage.");

    rerender(
      <DocumentViewer
        {...props}
        notice={{ kind: "success", message: "Feedback updated." }}
      />,
    );

    expect(screen.getByText("Selected passage.")).toBe(
      passageBeforeRerender,
    );
  });

  it("reports the rendered headings as the outline", () => {
    const onOutlineChange = vi.fn();

    render(
      <DocumentViewer
        document={{
          ...document,
          content: [
            "## First section",
            "",
            "### Deep detail",
            "",
            ':::pena-decision{#pick choice-a="Apply" choice-b="Skip"}',
            "# Nested question",
            "",
            "Body copy.",
            ":::",
          ].join("\n"),
        }}
        draftFeedback={[]}
        isPendingFeedbackOpen={true}
        submittedDecisions={{}}
        isSubmitting={false}
        notice={null}
        onDraftSaved={vi.fn()}
        onDraftDeleted={vi.fn()}
        onDecisionDraftChanged={vi.fn()}
        onNoticeClear={vi.fn()}
        onPendingFeedbackOpenChange={vi.fn()}
        onSubmitFeedback={vi.fn()}
        onOutlineChange={onOutlineChange}
        onActiveSectionChange={vi.fn()}
      />,
    );

    expect(onOutlineChange).toHaveBeenCalledWith([
      { id: "pena-section-0", text: "Highlight Test", depth: 0 },
      { id: "pena-section-1", text: "First section", depth: 1 },
      { id: "pena-section-2", text: "Deep detail", depth: 2 },
      // The decision's own heading belongs under the section that introduces it.
      { id: "pena-section-3", text: "Nested question", depth: 1 },
    ]);
  });

  it("scrolls to a sidebar comment before opening its editor", async () => {
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue(
      [new DOMRect(100, 700, 120, 20)] as unknown as DOMRectList,
    );
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 700, 120, 20),
    );
    vi.spyOn(
      HTMLElement.prototype,
      "getBoundingClientRect",
    ).mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("document-stage")) {
        return new DOMRect(0, 0, 800, 1_400);
      }

      if (this.classList.contains("selection-comment-popover")) {
        return new DOMRect(
          100,
          Number.parseFloat(this.style.top) || 0,
          360,
          280,
        );
      }

      return new DOMRect();
    });
    const user = userEvent.setup();

    render(
      <DocumentViewer
        document={document}
        draftFeedback={[
          {
            kind: "comment",
            id: "comment-1",
            selectedText: "Selected passage.",
            comment: "Clarify this sentence.",
            contextBefore: "",
            contextAfter: "",
            anchorId: "segment-0-block-12",
            anchorOffset: 0,
          },
        ]}
        isPendingFeedbackOpen={true}
        submittedDecisions={{}}
        isSubmitting={false}
        notice={null}
        onDraftSaved={vi.fn()}
        onDraftDeleted={vi.fn()}
        onDecisionDraftChanged={vi.fn()}
        onNoticeClear={vi.fn()}
        onPendingFeedbackOpenChange={vi.fn()}
        onSubmitFeedback={vi.fn()}
        onOutlineChange={vi.fn()}
        onActiveSectionChange={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /Selected passage.*Clarify this sentence/,
      }),
    );

    expect(scrollTo).toHaveBeenCalledWith({
      top: 672,
      behavior: "auto",
    });
    expect(
      screen.getByRole("textbox", { name: "Update your note" }),
    ).toBeTruthy();
  });
});
