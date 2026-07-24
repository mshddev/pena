// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReviewPage } from "./DocumentReviewPage";

const DECISION_DOCUMENT = [
  "# Review",
  "",
  ':::pena-decision{#request-cache choice-a="Apply" choice-b="Skip"}',
  "## Add request caching",
  "",
  "Cache repeated reads for five minutes.",
  ":::",
].join("\n");

const documentResponse = {
  workspaceSlug: "default",
  slug: "review",
  content: DECISION_DOCUMENT,
  version: 1,
  updatedAt: "2026-07-18T10:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("CSS", {
    escape: (value: string) => value,
  });
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return this.textContent ?? "";
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("interactive decision review", () => {
  it("selects, clears, changes, and submits a decision", async () => {
    const submittedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/workspaces/default/documents") {
        return documentListResponse();
      }

      if (init?.method === "POST") {
        submittedBodies.push(String(init.body));
        return jsonResponse({
          id: 1,
          submittedAt: "2026-07-18T10:01:00.000Z",
          comments: JSON.parse(String(init.body)).comments,
        }, 201);
      }

      if (url.endsWith("/feedback")) {
        return jsonResponse({ batches: [] });
      }

      return jsonResponse(documentResponse);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    const apply = await screen.findByRole("button", { name: "Apply" });
    const skip = screen.getByRole("button", { name: "Skip" });

    expect(screen.getByText("Version 1")).toBeTruthy();
    expect(apply.getAttribute("aria-pressed")).toBe("false");
    expect(skip.getAttribute("aria-pressed")).toBe("false");

    await user.click(apply);
    expect(screen.getByText("1 feedback ready to submit")).toBeTruthy();
    expect(apply.getAttribute("aria-pressed")).toBe("true");

    await user.click(apply);
    expect(
      screen.getByText("Choose a decision or select text to start."),
    ).toBeTruthy();

    await user.click(skip);
    expect(skip.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));

    await screen.findByText(
      "1 feedback submitted. Ask Claude to read your Pena feedback.",
    );
    expect(submittedBodies).toHaveLength(1);
    expect(JSON.parse(submittedBodies[0] ?? "{}").comments).toEqual([
      expect.objectContaining({
        comment: "[decision:request-cache] Skip",
      }),
    ]);
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect((skip as HTMLButtonElement).disabled).toBe(true);
    expect(skip.getAttribute("aria-pressed")).toBe("true");
  });

  it("restores submitted decisions as disabled choices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/workspaces/default/documents"
          ? documentListResponse()
          : String(input).endsWith("/feedback")
          ? jsonResponse({
              batches: [
                {
                  id: 1,
                  submittedAt: "2026-07-18T10:01:00.000Z",
                  comments: [
                    {
                      selectedText: "Add request caching",
                      comment: "[decision:request-cache] Apply",
                      contextBefore: "",
                      contextAfter: "",
                    },
                  ],
                },
              ],
            })
          : jsonResponse(documentResponse),
      ),
    );

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    const apply = await screen.findByRole("button", { name: "Apply" });
    const skip = screen.getByRole("button", { name: "Skip" });

    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect((skip as HTMLButtonElement).disabled).toBe(true);
    expect(apply.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Decision submitted")).toBeTruthy();
  });

  it("fails the page when decision feedback cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/workspaces/default/documents") {
          return documentListResponse();
        }

        if (String(input).endsWith("/feedback")) {
          throw new TypeError("Failed to fetch");
        }

        return jsonResponse(documentResponse);
      }),
    );

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    expect(
      await screen.findByRole("heading", {
        name: "Could not load document",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Failed to fetch")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("keeps Markdown-only loading behavior unchanged", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/workspaces/default/documents"
        ? documentListResponse()
        : jsonResponse({
            ...documentResponse,
            content: "# Markdown only\n\nSelect this passage.",
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    expect(
      await screen.findByRole("heading", { name: "Markdown only" }),
    ).toBeTruthy();
    expect(screen.queryByText("Decision required")).toBeNull();
    expect(
      screen.getByText("Select text in the document to start."),
    ).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});

describe("saved document index", () => {
  it("moves an active document to another workspace", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/workspaces") {
          return jsonResponse({
            workspaces: [
              {
                slug: "default",
                name: "Default",
                documentCount: 1,
                createdAt: "2026-07-18T10:00:00.000Z",
                updatedAt: "2026-07-18T10:00:00.000Z",
              },
              {
                slug: "research",
                name: "Research",
                documentCount: 0,
                createdAt: "2026-07-18T10:00:00.000Z",
                updatedAt: "2026-07-18T10:00:00.000Z",
              },
            ],
          });
        }

        if (url === "/api/workspaces/default/documents") {
          return documentListResponse();
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ batches: [] });
        }

        if (
          url === "/api/workspaces/default/documents/review/move" &&
          init?.method === "POST"
        ) {
          return jsonResponse(
            {
              error:
                'A document with slug "review" already exists in workspace "research".',
            },
            409,
          );
        }

        return jsonResponse(documentResponse);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    await screen.findByRole("button", { name: "Move" });
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(
      (screen.getByRole("combobox", {
        name: "Destination workspace",
      }) as HTMLSelectElement).value,
    ).toBe("research");
    await user.click(screen.getByRole("button", { name: "Move document" }));

    expect(
      await screen.findByText(
        'A document with slug "review" already exists in workspace "research".',
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/default/documents/review/move",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "research" }),
      },
    );
  });

  it("shows saved documents and marks the current document", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === "/api/workspaces/default/documents") {
          return jsonResponse({
            documents: [
              {
                slug: "review",
                version: 1,
                updatedAt: "2026-07-18T10:00:00.000Z",
              },
              {
                slug: "architecture-notes",
                version: 3,
                updatedAt: "2026-07-17T10:00:00.000Z",
              },
            ],
          });
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ batches: [] });
        }

        return jsonResponse(documentResponse);
      }),
    );

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    const currentDocument = await screen.findByRole("link", {
      name: /Review/,
    });
    const otherDocument = screen.getByRole("link", {
      name: /Architecture Notes/,
    });

    expect(currentDocument.getAttribute("aria-current")).toBe("page");
    expect(currentDocument.getAttribute("href")).toBe("/workspaces/default/documents/review");
    expect(otherDocument.getAttribute("href")).toBe(
      "/workspaces/default/documents/architecture-notes",
    );
    expect(screen.getByText("v3")).toBeTruthy();
  });

});

function documentListResponse(): Response {
  return jsonResponse({
    documents: [
      {
        slug: "review",
        version: 1,
        updatedAt: "2026-07-18T10:00:00.000Z",
      },
    ],
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
