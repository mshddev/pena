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
  ':::pena-decision{#request-cache choice-a="Apply" choice-b="Skip"}',
  "## Add request caching",
  "",
  "Cache repeated reads for five minutes.",
  ":::",
].join("\n");

const documentResponse = {
  workspaceSlug: "default",
  slug: "review",
  title: "Review",
  content: DECISION_DOCUMENT,
  version: 1,
  updatedAt: "2026-07-18T10:00:00.000Z",
  archivedAt: null,
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
  window.history.replaceState({}, "", "/");
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
        }, 201);
      }

      if (url.endsWith("/feedback")) {
        return jsonResponse({ latestBatchId: null, batches: [] });
      }

      return jsonResponse(documentResponse);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    const apply = await screen.findByRole("button", { name: "Apply" });
    const skip = screen.getByRole("button", { name: "Skip" });

    expect(screen.getByText("v1")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Review" })).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Rename document" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Document title")).toBeNull();
    expect(apply.getAttribute("aria-pressed")).toBe("false");
    expect(skip.getAttribute("aria-pressed")).toBe("false");
    // The feedback dock stays visible, but cannot submit an empty batch.
    expect(
      (screen.getByRole("button", {
        name: "Submit feedback",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(apply);
    expect(screen.getByText("1 item ready to submit")).toBeTruthy();
    expect(screen.getByText("1 decision")).toBeTruthy();
    expect(apply.getAttribute("aria-pressed")).toBe("true");

    await user.click(apply);
    expect(
      (screen.getByRole("button", {
        name: "Submit feedback",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/default/documents/review/feedback",
      { headers: { "if-match": '"pena-test-1"' } },
    );
  });

  it("restores submitted decisions as disabled choices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/workspaces/default/documents"
          ? documentListResponse()
          : String(input).endsWith("/feedback")
          ? jsonResponse({
              latestBatchId: 1,
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

  it("adds an overall instruction from the submit feedback widget", async () => {
    const submittedBodies: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (init?.method === "POST" && url.endsWith("/feedback")) {
          submittedBodies.push(String(init.body));
          return jsonResponse(
            {
              id: 1,
              submittedAt: "2026-07-18T10:01:00.000Z",
            },
            201,
          );
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ latestBatchId: null, batches: [] });
        }

        if (url === "/api/workspaces/default/documents") {
          return documentListResponse();
        }

        return jsonResponse(documentResponse);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    expect(screen.queryByRole("button", { name: "Instruction" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Apply" }));
    await user.click(screen.getByRole("button", { name: "Add instruction" }));
    await user.type(
      screen.getByRole("textbox", { name: "Overall instruction" }),
      "Keep the API unchanged and shorten the explanation.",
    );
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));

    expect(
      await screen.findByText(
        "1 feedback and an overall instruction submitted. Ask Claude to read your Pena feedback.",
      ),
    ).toBeTruthy();
    expect(JSON.parse(submittedBodies[0] ?? "{}")).toEqual({
      instruction: "Keep the API unchanged and shorten the explanation.",
      comments: [
        expect.objectContaining({
          comment: "[decision:request-cache] Apply",
        }),
      ],
    });
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
            content: "## Markdown only\n\nSelect this passage.",
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    expect(
      await screen.findByRole("heading", { name: "Markdown only" }),
    ).toBeTruthy();
    expect(screen.queryByText("Decision required")).toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Submit feedback",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // The document and the move destinations — the rail no longer needs a list.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("version history", () => {
  it("views, compares, and restores a historical version", async () => {
    const currentDocument = {
      ...documentResponse,
      title: "Second draft",
      content: "New line.",
      version: 2,
      updatedAt: "2026-07-18T11:00:00.000Z",
    };
    const restoredDocument = {
      ...currentDocument,
      title: "First draft",
      content: "Original line.",
      version: 3,
      updatedAt: "2026-07-18T12:00:00.000Z",
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/workspaces") {
          return jsonResponse({ workspaces: [] });
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ latestBatchId: null, batches: [] });
        }

        if (url.endsWith("/versions/1/restore") && init?.method === "POST") {
          return jsonResponse(restoredDocument, 200, '"pena-test-2"');
        }

        if (url.endsWith("/versions/1")) {
          return jsonResponse({
            workspaceSlug: "default",
            slug: "review",
            title: "First draft",
            content: "Original line.",
            version: 1,
            updatedAt: "2026-07-18T10:00:00.000Z",
          });
        }

        if (url.endsWith("/versions")) {
          return jsonResponse({
            versions: [
              {
                workspaceSlug: "default",
                slug: "review",
                title: "Second draft",
                version: 2,
                updatedAt: "2026-07-18T11:00:00.000Z",
              },
              {
                workspaceSlug: "default",
                slug: "review",
                title: "First draft",
                version: 1,
                updatedAt: "2026-07-18T10:00:00.000Z",
              },
            ],
          });
        }

        return jsonResponse(currentDocument);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    await user.click(
      await screen.findByRole("button", { name: "Version 2" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Version history" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^v1/ }));
    expect(
      await screen.findByRole("heading", { name: "First draft" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Version 1" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Compare versions" }));
    expect(
      await screen.findByLabelText("Version comparison"),
    ).toBeTruthy();
    expect(screen.getByText("Original line.")).toBeTruthy();
    expect(screen.getByText("New line.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^v1/ }));
    await user.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create restored version" }),
    );

    expect(
      await screen.findByText("Version 3 is now current."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/default/documents/review/versions/1/restore",
      {
        method: "POST",
        headers: { "if-match": '"pena-test-1"' },
      },
    );
  });
});

describe("saved document index", () => {
  it("restores a section hash after the async document render", async () => {
    const scrollIntoView = vi.fn();

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    window.history.replaceState({}, "", "/#pena-section-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : jsonResponse(documentResponse),
      ),
    );

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    const target = await screen.findByRole("heading", {
      name: "Add request caching",
    });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(target.id).toBe("pena-section-1");
    expect(scrollIntoView.mock.instances[0]).toBe(target);
  });

  it("keeps the document mounted while a focus refresh is pending", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    let documentFetchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/feedback")) {
        return jsonResponse({ latestBatchId: null, batches: [] });
      }

      if (url.endsWith("/documents/review")) {
        documentFetchCount += 1;
        return documentFetchCount === 1
          ? jsonResponse(documentResponse)
          : refreshResponse;
      }

      return documentListResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    await screen.findByRole("heading", { name: "Review" });
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(documentFetchCount).toBe(2));
    expect(screen.getAllByRole("heading", { name: "Review" })).toHaveLength(1);

    resolveRefresh?.(jsonResponse(documentResponse));
    await waitFor(() =>
      expect(screen.getAllByRole("heading", { name: "Review" })).toHaveLength(1),
    );
  });

  it("downloads the current document as an exact Markdown file", async () => {
    const NativeURL = URL;
    const createObjectURL = vi.fn((_blob: Blob) => "blob:pena-markdown");
    const revokeObjectURL = vi.fn();

    class DownloadURL extends NativeURL {}

    Object.defineProperties(DownloadURL, {
      createObjectURL: { value: createObjectURL },
      revokeObjectURL: { value: revokeObjectURL },
    });
    vi.stubGlobal("URL", DownloadURL);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : jsonResponse(documentResponse),
      ),
    );
    const user = userEvent.setup();

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    await user.click(
      await screen.findByRole("button", { name: "Download" }),
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const markdownBlob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(markdownBlob.type).toBe("text/markdown;charset=utf-8");
    expect(await markdownBlob.text()).toBe(DECISION_DOCUMENT);

    const downloadLink = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(downloadLink.download).toBe("review.md");
    expect(downloadLink.href).toBe("blob:pena-markdown");
    expect(downloadLink.isConnected).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pena-markdown");
  });

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
          return jsonResponse({ latestBatchId: null, batches: [] });
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
        // The move is conditional on the exact document state that was loaded.
        headers: {
          "content-type": "application/json",
          "if-match": '"pena-test-1"',
        },
        body: JSON.stringify({ workspaceSlug: "research" }),
      },
    );
  });

  it("outlines the document and links back to the workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : jsonResponse(documentResponse),
      ),
    );

    render(<DocumentReviewPage workspaceSlug="default" documentSlug="review" />);

    const outline = await screen.findByRole("complementary", {
      name: "Document outline",
    });
    await waitFor(() =>
      expect(
        outline.querySelectorAll(".document-outline-item"),
      ).toHaveLength(2),
    );
    const sections = [...outline.querySelectorAll(".document-outline-item")];

    expect(sections.map((section) => section.textContent)).toEqual([
      "Review",
      "Add request caching",
    ]);
    expect(sections[0]?.getAttribute("href")).toBe("#pena-section-0");
    expect(sections[0]?.getAttribute("data-depth")).toBe("0");
    expect((sections[0] as HTMLElement).style.getPropertyValue(
      "--outline-indent",
    )).toBe("0px");
    // The decision's heading nests under the section that introduces it, even
    // when it is the only subheading in the document.
    expect(sections[1]?.className).toContain("nested");
    expect(sections[1]?.getAttribute("data-depth")).toBe("1");
    expect((sections[1] as HTMLElement).style.getPropertyValue(
      "--outline-indent",
    )).toBe("12px");

    expect(
      screen
        .getByRole("link", { name: "default" })
        .getAttribute("href"),
    ).toBe("/workspaces/default");
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

function jsonResponse(
  body: unknown,
  status = 200,
  etag = '"pena-test-1"',
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      etag,
    },
  });
}
