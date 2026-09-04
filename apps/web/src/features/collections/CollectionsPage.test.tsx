// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollectionsPage } from "./CollectionsPage";

const timestamp = "2026-07-22T10:00:00.000Z";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("collection management", () => {
  it("creates a nested collection and renames one", async () => {
    let collections = [
      collection("research", "Research", null, 2, 0),
      collection("archive-notes", "Archive Notes", null, 0, 0),
    ];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections" && !init?.method) {
          return jsonResponse({ collections });
        }

        if (url === "/api/collections" && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toEqual({
            name: "Papers",
            parentSlug: "research",
          });
          const created = collection("papers", "Papers", "research", 0, 0);
          collections = [
            ...collections.map((item) =>
              item.slug === "research" ? { ...item, childCount: 1 } : item,
            ),
            created,
          ];
          return jsonResponse(created, 201);
        }

        if (
          url === "/api/collections/archive-notes" &&
          init?.method === "PATCH"
        ) {
          expect(JSON.parse(String(init.body))).toEqual({
            name: "Reading List",
          });
          return jsonResponse(
            collection("archive-notes", "Reading List", null, 0, 0),
          );
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CollectionsPage />);

    expect(
      await screen.findByRole("heading", { name: "Research" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New collection" }));
    await user.type(screen.getByLabelText("New collection"), "Papers");
    await user.selectOptions(screen.getByLabelText("Inside"), "research");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("heading", { name: "Papers" })).toBeTruthy();
    expect(screen.getByText("In Research")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Actions for Archive Notes" }),
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const renameInput = screen.getByLabelText("Collection name");
    await user.clear(renameInput);
    await user.type(renameInput, "Reading List");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(
      await screen.findByRole("heading", { name: "Reading List" }),
    ).toBeTruthy();
  });

  it("moves a collection into another without offering its own subtree", async () => {
    let collections = [
      collection("research", "Research", null, 0, 1),
      collection("papers", "Papers", "research", 0, 0),
      collection("ops", "Ops", null, 0, 0),
    ];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections" && !init?.method) {
          return jsonResponse({ collections });
        }

        if (url === "/api/collections/research" && init?.method === "PATCH") {
          expect(JSON.parse(String(init.body))).toEqual({ parentSlug: "ops" });
          collections = collections.map((item) =>
            item.slug === "research" ? { ...item, parentSlug: "ops" } : item,
          );
          return jsonResponse(collection("research", "Research", "ops", 0, 1));
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CollectionsPage />);
    await screen.findByRole("heading", { name: "Research" });

    await user.click(screen.getByRole("button", { name: "Actions for Research" }));
    await user.click(screen.getByRole("button", { name: "Move" }));

    const select = screen.getByLabelText("Move Research into") as HTMLSelectElement;
    const optionLabels = [...select.options].map((option) =>
      option.textContent?.trim(),
    );
    // Neither the collection itself nor its child is a valid destination.
    expect(optionLabels).toEqual(["Root", "Ops"]);

    await user.selectOptions(select, "ops");
    await user.click(screen.getByRole("button", { name: "Move collection" }));

    expect(
      await screen.findByText("Research moved into Ops."),
    ).toBeTruthy();
  });

  it("requires exact confirmation before deleting an empty collection", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections" && !init?.method) {
          return jsonResponse({
            collections: [
              collection("research", "Research", null, 1, 0),
              collection("scratch", "Scratch", null, 0, 0),
            ],
          });
        }

        if (url === "/api/collections/scratch" && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CollectionsPage />);
    await screen.findByRole("heading", { name: "Scratch" });

    // A collection that still holds documents cannot be deleted.
    await user.click(screen.getByRole("button", { name: "Actions for Research" }));
    expect(
      (screen.getByRole("button", { name: /Delete/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Actions for Scratch" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const confirmButton = screen.getByRole("button", {
      name: "Delete collection",
    }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    await user.type(screen.getByLabelText("Type scratch to confirm"), "scratch");
    expect(confirmButton.disabled).toBe(false);
    await user.click(confirmButton);

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Scratch" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/collections/scratch", {
      method: "DELETE",
    });
  });

  it("filters the collections by name, slug, or path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          collections: [
            collection("research", "Research", null, 1, 1),
            collection("papers", "Papers", "research", 0, 0),
            collection("roadmap-2026", "Roadmap 2026", null, 4, 0),
          ],
        }),
      ),
    );
    const user = userEvent.setup();

    render(<CollectionsPage />);
    await screen.findByRole("heading", { name: "Research" });

    await user.type(screen.getByLabelText("Filter collections"), "roadmap");
    expect(screen.queryByRole("heading", { name: "Research" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Roadmap 2026" })).toBeTruthy();

    await user.clear(screen.getByLabelText("Filter collections"));
    await user.type(screen.getByLabelText("Filter collections"), "research /");
    // A path match keeps the nested collection visible on its own.
    expect(screen.getByRole("heading", { name: "Papers" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Roadmap 2026" })).toBeNull();

    await user.clear(screen.getByLabelText("Filter collections"));
    await user.type(screen.getByLabelText("Filter collections"), "nothing");
    expect(screen.getByText("No collections match “nothing”.")).toBeTruthy();
  });
});

function collection(
  slug: string,
  name: string,
  parentSlug: string | null,
  documentCount: number,
  childCount: number,
) {
  return {
    slug,
    name,
    parentSlug,
    documentCount,
    childCount,
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
