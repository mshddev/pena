// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { findTextRange, readSelection, readTextOffset } from "./selection";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  window.document.body.replaceChildren();
});

describe("readSelection", () => {
  it("leaves script and style source out of a passage and its offset", () => {
    const surface = window.document.createElement("article");
    surface.innerHTML = [
      "<p>Intro.</p>",
      "<style>p { color: red; }</style>",
      "<p>Pick <b>this</b> plan.</p>",
      "<script>track();</script>",
      "<p>Outro.</p>",
    ].join("");
    window.document.body.append(surface);
    const range = window.document.createRange();
    range.selectNodeContents(surface.querySelector("b") as Node);
    const selection = window.getSelection() as Selection;
    selection.addRange(range);

    expect(readSelection(surface, selection)).toEqual({
      selectedText: "this",
      contextBefore: "Intro.Pick ",
      contextAfter: " plan.Outro.",
    });

    const offset = readTextOffset(surface, range, "this");

    expect(offset).toBe("Intro.Pick ".length);
    expect(findTextRange(surface, "this", offset ?? -1)?.toString()).toBe(
      "this",
    );
  });
});
