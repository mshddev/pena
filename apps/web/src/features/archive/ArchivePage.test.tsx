// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArchivePage } from "./ArchivePage";

const archivedDocument = {
  slug: "old-draft",
  version: 2,
  updatedAt: "2026-07-18T10:00:00.000Z",
  archivedAt: "2026-07-20T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("archive", () => {
  it("restores a document to the active index", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/documents") {
          return jsonResponse({ documents: [] });
        }

        if (url === "/api/documents?status=archived") {
          return jsonResponse({ documents: [archivedDocument] });
        }

        if (url.endsWith("/archive") && init?.method === "DELETE") {
          return jsonResponse({ ...archivedDocument, archivedAt: null });
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ArchivePage />);

    expect(
      await screen.findByRole("heading", { name: "Old Draft" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByText("Old Draft restored to Documents.")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Old Draft" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: /Old Draft/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/old-draft/archive",
      { method: "DELETE" },
    );
  });

  it("requires the exact slug before permanent deletion", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/documents") {
          return jsonResponse({ documents: [] });
        }

        if (url === "/api/documents?status=archived") {
          return jsonResponse({ documents: [archivedDocument] });
        }

        if (url === "/api/documents/old-draft" && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ArchivePage />);
    await screen.findByRole("heading", { name: "Old Draft" });
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    const confirmation = screen.getByLabelText(/Type old-draft to confirm/);
    const confirmButton = screen.getAllByRole("button", {
      name: "Delete permanently",
    })[1] as HTMLButtonElement;

    expect(confirmButton.disabled).toBe(true);
    await user.type(confirmation, "old-draft");
    expect(confirmButton.disabled).toBe(false);
    await user.click(confirmButton);

    expect(
      await screen.findByText("Old Draft permanently deleted."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Old Draft" }),
      ).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/old-draft", {
      method: "DELETE",
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
