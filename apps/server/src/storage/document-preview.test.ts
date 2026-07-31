import { describe, expect, it } from "vitest";

import { extractLeadingDocumentTitle } from "./document-preview.js";

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
