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

  it("keeps Markdown as the default format", () => {
    expect(readDocumentExcerpt("## Heading\n\n**Opening** prose.")).toBe(
      "Opening prose.",
    );
  });
});
