import { describe, expect, it } from "vitest";

import {
  extractLeadingDocumentTitle,
  readDocumentExcerpt,
} from "./document-preview.js";

describe("extractLeadingDocumentTitle", () => {
  it("extracts a leading ATX H1 and leaves only the body", () => {
    expect(
      extractLeadingDocumentTitle(
        "# **Initial** [Specification](https://example.com) #\n\nOpening prose.",
      ),
    ).toEqual({
      title: "Initial Specification",
      content: "Opening prose.",
    });
  });

  it("preserves front matter and CRLF line endings", () => {
    expect(
      extractLeadingDocumentTitle(
        "---\r\nauthor: claude\r\n---\r\n\r\nLegacy title\r\n===\r\n\r\nBody.\r\n",
      ),
    ).toEqual({
      title: "Legacy title",
      content: "---\r\nauthor: claude\r\n---\r\n\r\nBody.\r\n",
    });
  });

  it("does not extract an H1 after body content", () => {
    const content = "Opening prose.\n\n# Real section\n\nMore.";

    expect(extractLeadingDocumentTitle(content)).toEqual({
      title: null,
      content,
    });
  });
});

describe("readDocumentExcerpt", () => {
  it("reads the visible prose of an HTML page", () => {
    const content = `<!doctype html>
<html>
  <head><title>Ignored</title><style>body { color: red; }</style></head>
  <body>
    <!-- a note for the author -->
    <h1>Pricing page</h1>
    <p>Three <strong>plans</strong>, one &amp; only <a href="#">checkout</a>.</p>
    <svg><text>Chart label</text></svg>
    <script>console.log("never shown");</script>
    <p>Taxes&nbsp;included&#33;</p>
  </body>
</html>`;

    expect(readDocumentExcerpt(content, "html")).toBe(
      "Three plans, one & only checkout. Taxes included!",
    );
  });

  it("reads an Excalidraw scene's text in reading order", () => {
    const scene = JSON.stringify({
      type: "excalidraw",
      elements: [
        { id: "db", type: "rectangle", x: 400, y: 200, label: { text: "Database" } },
        { id: "title", type: "text", x: 0, y: 0, text: "Checkout\nflow", originalText: "Checkout flow" },
        { id: "api", type: "rectangle", x: 0, y: 200, label: { text: "API" } },
        { id: "gone", type: "text", x: 0, y: 100, text: "Deleted", isDeleted: true },
        { id: "arrow", type: "arrow", x: 100, y: 220 },
      ],
    });

    expect(readDocumentExcerpt(scene, "excalidraw")).toBe(
      "Checkout flow API Database",
    );
    expect(readDocumentExcerpt("not a scene", "excalidraw")).toBe("");
  });

  it("keeps Markdown as the default format", () => {
    expect(readDocumentExcerpt("## Heading\n\n**Opening** prose.")).toBe(
      "Opening prose.",
    );
  });
});
