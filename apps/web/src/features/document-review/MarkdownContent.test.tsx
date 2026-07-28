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
    expect(callout.querySelector("svg.octicon")).not.toBeNull();
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

describe("embedded HTML", () => {
  it("renders CommonMark details blocks with Markdown content", () => {
    const { container } = render(
      <MarkdownContent
        components={createAnnotatedMarkdownComponents("segment-0")}
      >
        {
          "<details open>\n<summary>Expand Details</summary>\n\n**`premium_request` — the wallet**\n\n</details>"
        }
      </MarkdownContent>,
    );

    const details = container.querySelector("details");
    const summary = screen.getByText("Expand Details");
    const strong = screen.getByText(/premium_request/);

    expect(details).not.toBeNull();
    expect(details?.open).toBe(true);
    expect(details?.dataset.annotationBlock).toBe("segment-0-block-0");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("summary")?.dataset.annotationBlock).toBe(
      "segment-0-block-15",
    );
    expect(strong.tagName).toBe("CODE");
    expect(strong.closest("strong")).not.toBeNull();
  });

  it("removes executable HTML and unsafe attributes", () => {
    const { container } = render(
      <MarkdownContent components={markdownComponents}>
        {
          '<details onclick="alert(1)"><summary>Safe details</summary>\n\n<a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>\n\n<script>window.pwned = true</script>\n\n</details>'
        }
      </MarkdownContent>,
    );

    const details = container.querySelector("details");
    const link = screen.getByText("Unsafe link").closest("a");

    expect(details).not.toBeNull();
    expect(details?.hasAttribute("onclick")).toBe(false);
    expect(link).not.toBeNull();
    expect(link?.hasAttribute("href")).toBe(false);
    expect(link?.hasAttribute("onclick")).toBe(false);
    expect(container.querySelector("script")).toBeNull();
  });
});
