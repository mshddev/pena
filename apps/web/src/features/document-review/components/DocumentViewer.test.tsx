// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentViewer } from "./DocumentViewer";

const document = {
  slug: "highlight-test",
  content: "# Heading\n\nSelected passage.",
  version: 1,
  updatedAt: "2026-07-20T10:00:00.000Z",
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
});
