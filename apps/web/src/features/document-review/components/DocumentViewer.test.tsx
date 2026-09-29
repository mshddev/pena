// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentViewer } from "./DocumentViewer";

const document = {
  slug: "highlight-test",
  collectionSlug: null,
  title: "Highlight Test",
  content: "## Heading\n\nSelected passage.",
  format: "markdown" as const,
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
      feedbackInstruction: "",
      isInstructionComposerOpen: false,
      isPendingFeedbackOpen: true,
      submittedDecisions: {},
      isSubmitting: false,
      notice: null,
      onDraftSaved: vi.fn(),
      onDraftDeleted: vi.fn(),
      onDecisionDraftChanged: vi.fn(),
      onNoticeClear: vi.fn(),
      onFeedbackInstructionChange: vi.fn(),
      onInstructionComposerOpenChange: vi.fn(),
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
        feedbackInstruction=""
        isInstructionComposerOpen={false}
        isPendingFeedbackOpen={true}
        submittedDecisions={{}}
        isSubmitting={false}
        notice={null}
        onDraftSaved={vi.fn()}
        onDraftDeleted={vi.fn()}
        onDecisionDraftChanged={vi.fn()}
        onNoticeClear={vi.fn()}
        onFeedbackInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={vi.fn()}
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
        feedbackInstruction=""
        isInstructionComposerOpen={false}
        isPendingFeedbackOpen={true}
        submittedDecisions={{}}
        isSubmitting={false}
        notice={null}
        onDraftSaved={vi.fn()}
        onDraftDeleted={vi.fn()}
        onDecisionDraftChanged={vi.fn()}
        onNoticeClear={vi.fn()}
        onFeedbackInstructionChange={vi.fn()}
        onInstructionComposerOpenChange={vi.fn()}
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

  describe("with an HTML document", () => {
    const page = [
      '<h2 id="plans">Plans</h2>',
      "<p>Pick a plan.</p>",
      "<script>window.ran = true;</script>",
    ].join("");
    const htmlDocument = { ...document, content: page, format: "html" as const };

    // The composer clamps itself into the viewport, which only settles with
    // a popover rect that follows its position.
    beforeEach(() => {
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("selection-comment-popover")
          ? new DOMRect(100, Number.parseFloat(this.style.top) || 0, 360, 280)
          : new DOMRect();
      });
    });

    function renderHtmlViewer(
      overrides: Partial<ComponentProps<typeof DocumentViewer>> = {},
    ) {
      return render(
        <DocumentViewer
          document={htmlDocument}
          draftFeedback={[]}
          feedbackInstruction=""
          isInstructionComposerOpen={false}
          isPendingFeedbackOpen={true}
          submittedDecisions={{}}
          isSubmitting={false}
          notice={null}
          onDraftSaved={vi.fn()}
          onDraftDeleted={vi.fn()}
          onDecisionDraftChanged={vi.fn()}
          onNoticeClear={vi.fn()}
          onFeedbackInstructionChange={vi.fn()}
          onInstructionComposerOpenChange={vi.fn()}
          onPendingFeedbackOpenChange={vi.fn()}
          onSubmitFeedback={vi.fn()}
          onOutlineChange={vi.fn()}
          onActiveSectionChange={vi.fn()}
          {...overrides}
        />,
      );
    }

    // jsdom never parses srcdoc, so the test writes the page in and fires the
    // load a browser would. The frame's own Range has no layout either.
    function loadFrame(): {
      frameDocument: Document;
      frameWindow: Window & typeof globalThis;
    } {
      const frame = screen.getByTitle("Highlight Test") as HTMLIFrameElement;
      const frameDocument = frame.contentDocument as Document;
      const frameWindow = frame.contentWindow as Window & typeof globalThis;
      frameDocument.body.innerHTML = page;
      Object.defineProperty(frameWindow.Range.prototype, "getClientRects", {
        configurable: true,
        value: () => [new DOMRect(10, 20, 30, 10)],
      });
      Object.defineProperty(
        frameWindow.Range.prototype,
        "getBoundingClientRect",
        { configurable: true, value: () => new DOMRect(10, 20, 30, 10) },
      );
      act(() => {
        frame.dispatchEvent(new Event("load"));
      });

      return { frameDocument, frameWindow };
    }

    function selectInFrame(frameDocument: Document, text: string): void {
      const paragraph = frameDocument.querySelector("p")?.firstChild as Text;
      const start = paragraph.data.indexOf(text);
      const range = frameDocument.createRange();
      range.setStart(paragraph, start);
      range.setEnd(paragraph, start + text.length);
      frameDocument.getSelection()?.addRange(range);
    }

    it("renders the page in a scripted frame and outlines its headings", () => {
      const onOutlineChange = vi.fn();
      renderHtmlViewer({ onOutlineChange });
      const frame = screen.getByTitle("Highlight Test");

      expect(frame.getAttribute("srcdoc")).toBe(page);
      expect(frame.getAttribute("sandbox")?.split(" ")).toEqual(
        expect.arrayContaining(["allow-scripts", "allow-same-origin"]),
      );

      const { frameDocument } = loadFrame();

      expect(onOutlineChange).toHaveBeenLastCalledWith([
        { id: "pena-section-0", text: "Highlight Test", depth: 0 },
        { id: "pena-section-1", text: "Plans", depth: 1 },
      ]);
      // The page keeps its own heading ids.
      expect(frameDocument.querySelector("h2")?.id).toBe("plans");
    });

    it("opens the composer for a passage selected inside the page", () => {
      renderHtmlViewer();
      const { frameDocument, frameWindow } = loadFrame();

      selectInFrame(frameDocument, "a plan");
      act(() => {
        frameDocument.body.dispatchEvent(
          new frameWindow.MouseEvent("mouseup", { bubbles: true }),
        );
      });

      expect(screen.getByRole("textbox", { name: "Your comment" })).toBeTruthy();
      expect(screen.getByText("a plan", { selector: "blockquote" })).toBeTruthy();

      // The composer sits outside the frame, so pressing in the page closes it.
      act(() => {
        frameDocument.body.dispatchEvent(
          new frameWindow.PointerEvent("pointerdown", { bubbles: true }),
        );
      });

      expect(screen.queryByRole("textbox", { name: "Your comment" })).toBeNull();
    });

    it("keeps the composer closed when Escape is released inside the page", () => {
      renderHtmlViewer();
      const { frameDocument, frameWindow } = loadFrame();
      selectInFrame(frameDocument, "a plan");
      act(() => {
        frameDocument.body.dispatchEvent(
          new frameWindow.MouseEvent("mouseup", { bubbles: true }),
        );
      });
      const key = (type: string, init: KeyboardEventInit) =>
        act(() => {
          frameDocument.body.dispatchEvent(
            new frameWindow.KeyboardEvent(type, {
              bubbles: true,
              cancelable: true,
              ...init,
            }),
          );
        });

      key("keydown", { key: "Escape" });
      key("keyup", { key: "Escape" });

      expect(screen.queryByRole("textbox", { name: "Your comment" })).toBeNull();

      // Extending the selection from the keyboard opens it again.
      key("keyup", { key: "ArrowRight", shiftKey: true });

      expect(screen.getByRole("textbox", { name: "Your comment" })).toBeTruthy();
    });

    it("refetches on returning to the window with focus inside the page", () => {
      vi.useFakeTimers();
      const onWindowFocus = vi.fn();
      window.addEventListener("focus", onWindowFocus);
      renderHtmlViewer();
      const { frameWindow } = loadFrame();
      const hasFocus = vi.spyOn(window.document, "hasFocus");

      // Focus moving from the page to Pena's own controls is not a return.
      hasFocus.mockReturnValue(true);
      frameWindow.dispatchEvent(new frameWindow.FocusEvent("blur"));
      vi.runAllTimers();
      frameWindow.dispatchEvent(new frameWindow.FocusEvent("focus"));

      expect(onWindowFocus).not.toHaveBeenCalled();

      hasFocus.mockReturnValue(false);
      frameWindow.dispatchEvent(new frameWindow.FocusEvent("blur"));
      vi.runAllTimers();
      frameWindow.dispatchEvent(new frameWindow.FocusEvent("focus"));

      expect(onWindowFocus).toHaveBeenCalledTimes(1);
      window.removeEventListener("focus", onWindowFocus);
      vi.useRealTimers();
    });

    it("hands Pena's shortcuts pressed inside the page to the review page", () => {
      renderHtmlViewer();
      const { frameDocument, frameWindow } = loadFrame();
      selectInFrame(frameDocument, "Pick");
      const shortcut = new frameWindow.KeyboardEvent("keydown", {
        key: "m",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        frameDocument.body.dispatchEvent(shortcut);
      });

      expect(shortcut.defaultPrevented).toBe(true);
      expect(screen.getByText("Pick", { selector: "blockquote" })).toBeTruthy();
    });
  });
});
