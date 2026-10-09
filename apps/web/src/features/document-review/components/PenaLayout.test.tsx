// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PenaLayout } from "./PenaLayout";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("PenaLayout", () => {
  it("resizes, persists, and resets the document outline", async () => {
    window.localStorage.setItem("pena:outline-width", "280");
    window.localStorage.setItem("pena:outline-open", "open");
    const user = userEvent.setup();

    render(
      <PenaLayout
        activeSectionId={null}
        sections={[]}
        bar={<span>Bar</span>}
        barTitle="Document"
      >
        <div>Document</div>
      </PenaLayout>,
    );

    const layout = screen.getByRole("main");
    const resizer = screen.getByRole("separator", {
      name: "Resize document outline",
    });

    expect(layout.style.getPropertyValue("--outline-width")).toBe("280px");
    expect(resizer.getAttribute("aria-valuenow")).toBe("280");

    resizer.focus();
    await user.keyboard("{ArrowRight}");

    expect(layout.style.getPropertyValue("--outline-width")).toBe("292px");
    expect(window.localStorage.getItem("pena:outline-width")).toBe("292");

    await user.keyboard("{End}");

    expect(layout.style.getPropertyValue("--outline-width")).toBe("420px");

    await user.dblClick(resizer);

    expect(layout.style.getPropertyValue("--outline-width")).toBe("");
    expect(window.localStorage.getItem("pena:outline-width")).toBeNull();
  });

  it("starts folded, then opens, folds, and persists the outline", async () => {
    const user = userEvent.setup();

    render(
      <PenaLayout
        activeSectionId={null}
        sections={[]}
        bar={<span>Bar</span>}
        barTitle="Document"
      >
        <section className="document-pane">Document</section>
      </PenaLayout>,
    );

    const layout = screen.getByRole("main");
    const toggle = screen.getByRole("button", { name: "Document outline" });

    expect(layout.className).toContain("outline-collapsed");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("separator", { name: "Resize document outline" }),
    ).toBeNull();
    // Arriving is not a choice, so nothing is saved yet.
    expect(window.localStorage.getItem("pena:outline-open")).toBeNull();

    await user.click(toggle);

    const outline = screen.getByRole("complementary", {
      name: "Document outline",
    });
    expect(layout.className).not.toContain("outline-collapsed");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(outline.getAttribute("aria-hidden")).toBe("false");
    expect(
      screen.getByRole("separator", { name: "Resize document outline" }),
    ).toBeTruthy();
    expect(window.localStorage.getItem("pena:outline-open")).toBe("open");

    await user.click(
      screen.getByRole("button", { name: "Hide document outline" }),
    );

    expect(layout.className).toContain("outline-collapsed");
    expect(outline.getAttribute("aria-hidden")).toBe("true");
    expect(window.localStorage.getItem("pena:outline-open")).toBe("closed");
  });

  it("opens the outline when that preference was saved", () => {
    window.localStorage.setItem("pena:outline-open", "open");
    // The old key was written on every visit, so it is cleared, not read.
    window.localStorage.setItem("pena:outline-visibility", "open");

    render(
      <PenaLayout
        activeSectionId={null}
        sections={[]}
        bar={<span>Bar</span>}
        barTitle="Document"
      >
        <section className="document-pane">Document</section>
      </PenaLayout>,
    );

    expect(screen.getByRole("main").className).not.toContain(
      "outline-collapsed",
    );
    expect(window.localStorage.getItem("pena:outline-visibility")).toBeNull();
  });

  it("starts folded when only the old visibility key is saved", () => {
    window.localStorage.setItem("pena:outline-visibility", "open");

    render(
      <PenaLayout
        activeSectionId={null}
        sections={[]}
        bar={<span>Bar</span>}
        barTitle="Document"
      >
        <section className="document-pane">Document</section>
      </PenaLayout>,
    );

    expect(screen.getByRole("main").className).toContain("outline-collapsed");
  });
});
