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

describe("findTextRange", () => {
  const context = {
    contextBefore: "Updated 9:59. Plans: Starter ",
    contextAfter: " a month. Team ",
  };

  it("finds a passage moved by a change to the text in front of it", () => {
    const surface = window.document.createElement("article");
    // A ticking clock grew by a character after the passage was read.
    surface.innerHTML =
      "<p>Updated 10:00.</p><p>Plans: Starter <b>$12</b> a month. Team <b>$12</b> a seat.</p>";
    const formerStart = "Updated 9:59.Plans: Starter ".length;

    expect(findTextRange(surface, "$12", formerStart)).toBeNull();

    const range = findTextRange(surface, "$12", formerStart, context);

    // A range starts at the end of the text before it, so its end locates it.
    expect(range?.toString()).toBe("$12");
    expect(range?.endContainer.parentElement).toBe(
      surface.querySelectorAll("b")[0],
    );
  });

  it("picks the occurrence whose surroundings match, not the nearest", () => {
    const surface = window.document.createElement("article");
    surface.innerHTML =
      "<p>Team <b>$12</b> a seat.</p><p>Plans: Starter <b>$12</b> a month.</p>";

    const range = findTextRange(surface, "$12", 0, context);

    expect(range?.endContainer.parentElement).toBe(
      surface.querySelectorAll("b")[1],
    );
  });
});
