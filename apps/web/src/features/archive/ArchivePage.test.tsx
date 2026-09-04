// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArchivePage } from "./ArchivePage";

const archivedDocument = {
  slug: "old-draft",
  collectionSlug: "research",
  title: "Old Draft",
  version: 2,
  updatedAt: "2026-07-18T10:00:00.000Z",
  archivedAt: "2026-07-20T10:00:00.000Z",
  excerpt: "",
};

const research = {
  slug: "research",
  name: "Research",
  parentSlug: null,
  documentCount: 1,
  childCount: 0,
  createdAt: "2026-07-18T10:00:00.000Z",
  updatedAt: "2026-07-18T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("archive", () => {
  it("shows the global archive and unarchives back to the collection", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections") {
          return jsonResponse({ collections: [research] });
        }

        if (url === "/api/archive") {
          return jsonResponse({ documents: [archivedDocument] });
        }

        if (url === "/api/docs/old-draft" && !init?.method) {
          return jsonResponse({
            ...archivedDocument,
            content: "Archived content",
          });
        }

        if (url === "/api/docs/old-draft" && init?.method === "PATCH") {
          return jsonResponse({ ...archivedDocument, archivedAt: null });
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ArchivePage collectionSlug={null} />);

    expect(
      await screen.findByRole("heading", { name: "Old Draft" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Old Draft" }).getAttribute("href"),
    ).toBe("/docs/old-draft");
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: "Research" })
        .some((link) => link.getAttribute("href") === "/collections/research"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Unarchive" }));

    expect(
      await screen.findByText("Old Draft unarchived in Research."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Old Draft" }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/docs/old-draft", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": '"pena-test-2"',
      },
      body: JSON.stringify({ status: "active" }),
    });
  });

  it("labels root documents and filters by collection", async () => {
    const rootDocument = { ...archivedDocument, collectionSlug: null };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections") {
          return jsonResponse({ collections: [research] });
        }

        if (url === "/api/archive?collection=research") {
          return jsonResponse({ documents: [rootDocument] });
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ArchivePage collectionSlug="research" />);

    await screen.findByRole("heading", { name: "Old Draft" });
    expect(
      screen.getByRole("link", { name: "Root" }).getAttribute("href"),
    ).toBe("/");
    expect(
      screen.getByRole("link", { name: "Archive" }).getAttribute("href"),
    ).toBe("/archive?collection=research");

    await user.click(
      screen.getByRole("button", { name: /Archive · Research/ }),
    );
    expect(
      screen.getByRole("link", { name: "All documents" }).getAttribute("href"),
    ).toBe("/archive");
  });

  it("takes a second explicit confirmation before permanent deletion", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections") {
          return jsonResponse({ collections: [] });
        }

        if (url === "/api/archive?collection=research") {
          return jsonResponse({ documents: [archivedDocument] });
        }

        if (url === "/api/docs/old-draft" && !init?.method) {
          return jsonResponse({
            ...archivedDocument,
            content: "Archived content",
          });
        }

        if (url === "/api/docs/old-draft" && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ArchivePage collectionSlug="research" />);
    await screen.findByRole("heading", { name: "Old Draft" });
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    // The row expands to spell out what is lost; nothing is sent until the
    // second, differently-worded button is pressed.
    expect(
      screen.getByText("Permanently delete Old Draft?"),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/docs/old-draft", {
      method: "DELETE",
    });

    await user.click(
      screen.getByRole("button", { name: "Yes, delete permanently" }),
    );

    expect(
      await screen.findByText("Old Draft permanently deleted."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Old Draft" }),
      ).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/docs/old-draft", {
      method: "DELETE",
      headers: { "if-match": '"pena-test-2"' },
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      etag: '"pena-test-2"',
    },
  });
}
