// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { MarkdownContent } from "./MarkdownContent";
import {
  createAnnotatedMarkdownComponents,
  markdownComponents,
} from "./markdown-components";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

afterEach(cleanup);

beforeEach(() => {
  mermaid.initialize.mockClear();
  mermaid.render.mockReset();
  mermaid.render.mockResolvedValue({
    svg: '<svg data-rendered-mermaid="true"></svg>',
  });
});

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

describe("Mermaid diagrams", () => {
  it("renders Mermaid fences as annotated diagrams using strict mode", async () => {
    const { container } = render(
      <MarkdownContent
        components={createAnnotatedMarkdownComponents("segment-0")}
      >
        {"```mermaid\nflowchart LR\n  A --> B\n```"}
      </MarkdownContent>,
    );

    expect(screen.getByText("Rendering diagram…")).toBeTruthy();

    const diagram = await screen.findByRole("img", {
      name: "Mermaid diagram",
    });
    const figure = diagram.closest("figure");

    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "dark",
    });
    expect(mermaid.render).toHaveBeenCalledWith(
      expect.stringMatching(/^pena-mermaid-/),
      "flowchart LR\n  A --> B",
    );
    expect(figure?.dataset.annotationBlock).toBe("segment-0-block-0");
    expect(
      diagram.querySelector('svg[data-rendered-mermaid="true"]'),
    ).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("leaves ordinary fenced code unchanged", () => {
    const { container } = render(
      <MarkdownContent components={markdownComponents}>
        {"```typescript\nconst answer = 42;\n```"}
      </MarkdownContent>,
    );

    const code = screen.getByText("const answer = 42;");

    expect(code.tagName).toBe("CODE");
    expect(code.classList.contains("language-typescript")).toBe(true);
    expect(code.closest("pre")).not.toBeNull();
    expect(container.querySelector(".mermaid-diagram")).toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("renders multiple Mermaid fences with independent IDs", async () => {
    render(
      <MarkdownContent components={markdownComponents}>
        {
          "```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: Hello\n```"
        }
      </MarkdownContent>,
    );

    expect(
      await screen.findAllByRole("img", { name: "Mermaid diagram" }),
    ).toHaveLength(2);

    const calls = mermaid.render.mock.calls;
    expect(calls.map((call) => call[1])).toEqual([
      "flowchart LR\n  A --> B",
      "sequenceDiagram\n  A->>B: Hello",
    ]);
    expect(new Set(calls.map((call) => call[0])).size).toBe(2);
  });

  it("shows the source and error when Mermaid syntax is invalid", async () => {
    mermaid.render.mockRejectedValueOnce(new Error("Parse error on line 1"));

    render(
      <MarkdownContent components={markdownComponents}>
        {"```mermaid\nthis is not a diagram\n```"}
      </MarkdownContent>,
    );

    expect(
      await screen.findByText("Unable to render Mermaid diagram"),
    ).toBeTruthy();
    expect(screen.getByText("Parse error on line 1")).toBeTruthy();

    const source = screen.getByText("this is not a diagram");
    expect(source.tagName).toBe("CODE");
    expect(source.classList.contains("language-mermaid")).toBe(true);
  });
});
