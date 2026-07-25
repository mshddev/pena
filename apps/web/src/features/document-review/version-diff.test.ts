import { describe, expect, it } from "vitest";

import { diffMarkdown } from "./version-diff";

describe("diffMarkdown", () => {
  it("keeps shared lines and marks replacements", () => {
    expect(diffMarkdown("# Title\n\nOld line", "# Title\n\nNew line")).toEqual([
      { kind: "context", text: "# Title" },
      { kind: "context", text: "" },
      { kind: "removed", text: "Old line" },
      { kind: "added", text: "New line" },
    ]);
  });

  it("returns only context for identical Markdown", () => {
    expect(diffMarkdown("Same\ncontent", "Same\ncontent")).toEqual([
      { kind: "context", text: "Same" },
      { kind: "context", text: "content" },
    ]);
  });
});
