// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownContent } from "./MarkdownContent";
import {
  createAnnotatedMarkdownComponents,
  markdownComponents,
} from "./markdown-components";

afterEach(cleanup);

describe("Markdown callouts", () => {
  it("renders Pena's legacy bare info marker as an annotated callout", () => {
    render(
      <MarkdownContent
        components={createAnnotatedMarkdownComponents("segment-0")}
      >
        {"[!info]\n*Do not confuse this with `app/Entities/Point/*`.*"}
      </MarkdownContent>,
    );

    const callout = screen.getByRole("note");
    const body = within(callout).getByText(/Do not confuse this/);
    const title = within(callout).getByText("Info");

    expect(callout.classList.contains("markdown-alert-note")).toBe(true);
    expect(callout.dataset.annotationBlock).toBe("segment-0-block-0");
    expect(body.closest("p")?.dataset.annotationBlock).toBe(
      "segment-0-block-0",
    );
    expect(body.tagName).toBe("EM");
    expect(title.closest("p")?.hasAttribute("data-pena-annotation")).toBe(true);
    expect(screen.queryByText("[!info]")).toBeNull();
  });

  it("supports standard GitHub alerts and the blockquoted info alias", () => {
    const { rerender } = render(
      <MarkdownContent components={markdownComponents}>
        {"> [!WARNING]\n> **Stop** and review."}
      </MarkdownContent>,
    );

    let callout = screen.getByRole("note");

    expect(callout.classList.contains("markdown-alert-warning")).toBe(true);
    expect(within(callout).getByText("WARNING")).toBeTruthy();
    expect(within(callout).getByText("Stop").tagName).toBe("STRONG");

    rerender(
      <MarkdownContent components={markdownComponents}>
        {"> [!info]\n> Existing Obsidian-style info."}
      </MarkdownContent>,
    );

    callout = screen.getByRole("note");
    expect(callout.classList.contains("markdown-alert-note")).toBe(true);
    expect(within(callout).getByText("Info")).toBeTruthy();
  });

  it("leaves unknown markers and ordinary blockquotes untouched", () => {
    const { container } = render(
      <MarkdownContent components={markdownComponents}>
        {"[!custom]\nStill ordinary text.\n\n> Ordinary quotation."}
      </MarkdownContent>,
    );

    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText(/\[!custom\]/)).toBeTruthy();
    expect(container.querySelector("blockquote")?.textContent.trim()).toBe(
      "Ordinary quotation.",
    );
  });
});
