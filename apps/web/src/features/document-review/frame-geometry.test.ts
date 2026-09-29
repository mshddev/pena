// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { toViewportRect } from "./frame-geometry";

afterEach(() => {
  vi.restoreAllMocks();
  window.document.body.replaceChildren();
});

describe("toViewportRect", () => {
  it("offsets a rect inside a frame by the frame's position", () => {
    const frame = window.document.createElement("iframe");
    window.document.body.append(frame);
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
      new DOMRect(10, 200, 600, 900),
    );
    const paragraph = frame.contentDocument?.createElement("p") as Node;

    expect(
      toViewportRect(new DOMRect(5, 7, 30, 40), paragraph, window.document),
    ).toEqual(new DOMRect(15, 207, 30, 40));
  });

  it("leaves a rect in the viewport's own document unchanged", () => {
    const paragraph = window.document.createElement("p");

    expect(
      toViewportRect(new DOMRect(5, 7, 30, 40), paragraph, window.document),
    ).toEqual(new DOMRect(5, 7, 30, 40));
  });
});
