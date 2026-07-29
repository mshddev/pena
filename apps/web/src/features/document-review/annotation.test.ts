// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { findDraftRange } from "./annotation";
import type { DraftComment } from "./types";

describe("findDraftRange", () => {
  it("checks every matching anchor when legacy markup has duplicate IDs", () => {
    const surface = document.createElement("article");
    surface.innerHTML = `
      <aside data-annotation-block="duplicate">
        Info
        <p data-annotation-block="duplicate">prefix selected passage suffix</p>
      </aside>
    `;
    const paragraph = surface.querySelector("p");
    const draft: DraftComment = {
      kind: "comment",
      id: "comment-1",
      anchorId: "duplicate",
      anchorOffset: "prefix ".length,
      selectedText: "selected passage",
      contextBefore: "",
      contextAfter: "",
      comment: "Open me",
    };

    const range = findDraftRange(surface, draft);

    expect(range?.toString()).toBe("selected passage");
    expect(range?.startContainer.parentElement).toBe(paragraph);
  });
});
