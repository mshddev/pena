// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentViewer } from "./DocumentViewer";

const document = {
  workspaceSlug: "default",
  slug: "highlight-test",
  content: "# Heading\n\nSelected passage.",
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DocumentViewer", () => {
  it("preserves Markdown text nodes across feedback rerenders", () => {
    const props: ComponentProps<typeof DocumentViewer> = {
      document,
      draftFeedback: [],
      submittedDecisions: {},
      isSubmitting: false,
      notice: null,
      onDraftSaved: vi.fn(),
      onDraftDeleted: vi.fn(),
      onDecisionDraftChanged: vi.fn(),
      onNoticeClear: vi.fn(),
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
            "# Title",
            "",
            "## First section",
            "",
            ':::pena-decision{#pick choice-a="Apply" choice-b="Skip"}',
            "## Nested question",
            "",
            "Body copy.",
            ":::",
          ].join("\n"),
        }}
        draftFeedback={[]}
        submittedDecisions={{}}
        isSubmitting={false}
        notice={null}
        onDraftSaved={vi.fn()}
        onDraftDeleted={vi.fn()}
        onDecisionDraftChanged={vi.fn()}
        onNoticeClear={vi.fn()}
        onSubmitFeedback={vi.fn()}
        onOutlineChange={onOutlineChange}
        onActiveSectionChange={vi.fn()}
      />,
    );

    expect(onOutlineChange).toHaveBeenCalledWith([
      { id: "pena-section-0", text: "Title", nested: false },
      { id: "pena-section-1", text: "First section", nested: false },
      // The decision's own heading belongs under the section that introduces it.
      { id: "pena-section-2", text: "Nested question", nested: true },
    ]);
  });
});
