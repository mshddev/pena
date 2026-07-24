// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspacesPage } from "./WorkspacesPage";

const timestamp = "2026-07-22T10:00:00.000Z";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workspace management", () => {
  it("creates and renames a workspace while protecting default", async () => {
    let workspaces = [
      workspace("default", "Default", 2),
      workspace("research", "Research", 0),
    ];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/workspaces" && !init?.method) {
          return jsonResponse({ workspaces });
        }

        if (url === "/api/workspaces" && init?.method === "POST") {
          const created = workspace("writing-room", "Writing Room", 0);
          workspaces = [...workspaces, created];
          return jsonResponse(created, 201);
        }

        if (
          url === "/api/workspaces/research" &&
          init?.method === "PATCH"
        ) {
          workspaces = workspaces.map((item) =>
            item.slug === "research" ? { ...item, name: "Research Lab" } : item,
          );
          return jsonResponse({ ...workspace("research", "Research Lab", 0) });
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<WorkspacesPage />);

    expect(await screen.findByRole("heading", { name: "Default" })).toBeTruthy();
    expect(screen.getByText("Protected")).toBeTruthy();
    // The protected workspace offers no actions menu at all.
    expect(
      screen.queryByRole("button", { name: "Actions for Default" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Actions for Research" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByLabelText("New workspace"), "Writing Room");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByRole("heading", { name: "Writing Room" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Actions for Research" }));
    const researchRow = screen.getByRole("heading", { name: "Research" }).closest("article");
    if (!researchRow) throw new Error("Research workspace card not found.");
    await user.click(withinButton(researchRow, "Rename"));
    const renameInput = screen.getByLabelText("Workspace name");
    await user.clear(renameInput);
    await user.type(renameInput, "Research Lab");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(
      await screen.findByRole("heading", { name: "Research Lab" }),
    ).toBeTruthy();
  });

  it("requires exact confirmation before deleting an empty workspace", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/workspaces" && !init?.method) {
          return jsonResponse({
            workspaces: [
              workspace("default", "Default", 0),
              workspace("research", "Research", 0),
            ],
          });
        }

        if (
          url === "/api/workspaces/research" &&
          init?.method === "DELETE"
        ) {
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<WorkspacesPage />);
    await screen.findByRole("heading", { name: "Research" });
    await user.click(screen.getByRole("button", { name: "Actions for Research" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const confirmButton = screen.getByRole("button", {
      name: "Delete workspace",
    }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    await user.type(screen.getByLabelText("Type research to confirm"), "research");
    expect(confirmButton.disabled).toBe(false);
    await user.click(confirmButton);

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Research" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/research", {
      method: "DELETE",
    });
  });

  it("filters the workspace cards by name or slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          workspaces: [
            workspace("default", "Default", 1),
            workspace("roadmap-2026", "Roadmap 2026", 4),
          ],
        }),
      ),
    );
    const user = userEvent.setup();

    render(<WorkspacesPage />);
    await screen.findByRole("heading", { name: "Default" });

    await user.type(screen.getByLabelText("Filter workspaces"), "roadmap");
    expect(screen.queryByRole("heading", { name: "Default" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Roadmap 2026" })).toBeTruthy();

    await user.clear(screen.getByLabelText("Filter workspaces"));
    await user.type(screen.getByLabelText("Filter workspaces"), "nothing");
    expect(screen.getByText("No workspaces match “nothing”.")).toBeTruthy();
  });
});

function workspace(slug: string, name: string, documentCount: number) {
  return {
    slug,
    name,
    documentCount,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withinButton(container: Element, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`${name} button not found.`);
  }

  return button;
}
