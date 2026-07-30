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
    const user = userEvent.setup();

    render(
      <PenaLayout
        activeSectionId={null}
        sections={[]}
        workspaceSlug="default"
      >
        <div>Document</div>
      </PenaLayout>,
    );

    const workspace = screen.getByRole("main");
    const resizer = screen.getByRole("separator", {
      name: "Resize document outline",
    });

    expect(workspace.style.getPropertyValue("--outline-width")).toBe("280px");
    expect(resizer.getAttribute("aria-valuenow")).toBe("280");

    resizer.focus();
    await user.keyboard("{ArrowRight}");

    expect(workspace.style.getPropertyValue("--outline-width")).toBe("292px");
    expect(window.localStorage.getItem("pena:outline-width")).toBe("292");

    await user.keyboard("{End}");

    expect(workspace.style.getPropertyValue("--outline-width")).toBe("420px");

    await user.dblClick(resizer);

    expect(workspace.style.getPropertyValue("--outline-width")).toBe("");
    expect(window.localStorage.getItem("pena:outline-width")).toBeNull();
  });

  it("folds, restores, and persists the document outline", async () => {
    const user = userEvent.setup();

    render(
      <PenaLayout
        activeSectionId={null}
        sections={[]}
        workspaceSlug="default"
      >
        <section className="document-pane">Document</section>
      </PenaLayout>,
    );

    const workspace = screen.getByRole("main");
    const outline = screen.getByRole("complementary", {
      name: "Document outline",
    });

    await user.click(
      screen.getByRole("button", { name: "Hide document outline" }),
    );

    expect(workspace.className).toContain("outline-collapsed");
    expect(outline.getAttribute("aria-hidden")).toBe("true");
    expect(
      screen.queryByRole("separator", { name: "Resize document outline" }),
    ).toBeNull();
    expect(window.localStorage.getItem("pena:outline-visibility")).toBe(
      "closed",
    );

    await user.click(
      screen.getByRole("button", { name: "Show document outline" }),
    );

    expect(workspace.className).not.toContain("outline-collapsed");
    expect(outline.getAttribute("aria-hidden")).toBe("false");
    expect(
      screen.getByRole("separator", { name: "Resize document outline" }),
    ).toBeTruthy();
    expect(window.localStorage.getItem("pena:outline-visibility")).toBe("open");
  });

  it("starts with the outline folded when that preference was saved", () => {
    window.localStorage.setItem("pena:outline-visibility", "closed");

    render(
      <PenaLayout
        activeSectionId={null}
        sections={[]}
        workspaceSlug="default"
      >
        <section className="document-pane">Document</section>
      </PenaLayout>,
    );

    expect(screen.getByRole("main").className).toContain("outline-collapsed");
    expect(
      screen.getByRole("button", { name: "Show document outline" }),
    ).toBeTruthy();
  });
});
