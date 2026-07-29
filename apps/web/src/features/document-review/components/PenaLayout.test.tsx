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
});
