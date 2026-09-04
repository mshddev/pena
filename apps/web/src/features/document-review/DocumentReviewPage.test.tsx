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

const DOCUMENT_URL = "/api/docs/review";

const documentResponse = {
  slug: "review",
  collectionSlug: null as string | null,
  title: "Review",
  content: DECISION_DOCUMENT,
  version: 1,
  updatedAt: "2026-07-18T10:00:00.000Z",
  archivedAt: null,
};

const researchCollection = {
  slug: "research",
  name: "Research",
  parentSlug: null,
  createdAt: "2026-07-18T10:00:00.000Z",
  updatedAt: "2026-07-18T10:00:00.000Z",
  documentCount: 0,
  childCount: 0,
};

const writingCollection = {
  slug: "writing",
  name: "Writing",
  parentSlug: null,
  createdAt: "2026-07-18T10:00:00.000Z",
  updatedAt: "2026-07-18T10:00:00.000Z",
  documentCount: 0,
  childCount: 0,
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

      if (url === "/api/collections") {
        return collectionListResponse();
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

    render(<DocumentReviewPage documentSlug="review" />);

    const apply = await screen.findByRole("button", { name: "Apply" });
    const skip = screen.getByRole("button", { name: "Skip" });

    expect(screen.getByText("v1")).toBeTruthy();
    const documentSlug = screen.getAllByText("review", { exact: true });
    expect(documentSlug).toHaveLength(1);
    expect(documentSlug[0]?.getAttribute("title")).toBe("review");
    const updatedAt = screen.getByText(/^Updated /);
    const expectedClockTime = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(documentResponse.updatedAt));
    expect(updatedAt.textContent).toContain(expectedClockTime);
    const documentUtilities = updatedAt.closest(".document-utilities");
    expect(documentUtilities?.contains(screen.getByRole("button", {
      name: "Version 1",
    }))).toBe(true);
    expect(documentUtilities?.contains(screen.getByRole("button", {
      name: "Download",
    }))).toBe(true);
    expect(
      updatedAt.compareDocumentPosition(screen.getByRole("button", {
        name: "Version 1",
      })) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    expect(fetchMock).toHaveBeenCalledWith(`${DOCUMENT_URL}/feedback`, {
      headers: { "if-match": '"pena-test-1"' },
    });
  });

  it("restores submitted decisions as disabled choices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/collections"
          ? collectionListResponse()
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

    render(<DocumentReviewPage documentSlug="review" />);

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

        if (url === "/api/collections") {
          return collectionListResponse();
        }

        return jsonResponse(documentResponse);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="review" />);

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
        if (String(input) === "/api/collections") {
          return collectionListResponse();
        }

        if (String(input).endsWith("/feedback")) {
          throw new TypeError("Failed to fetch");
        }

        return jsonResponse(documentResponse);
      }),
    );

    render(<DocumentReviewPage documentSlug="review" />);

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
      String(input) === "/api/collections"
        ? collectionListResponse()
        : jsonResponse({
            ...documentResponse,
            content: "## Markdown only\n\nSelect this passage.",
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentReviewPage documentSlug="review" />);

    expect(
      await screen.findByRole("heading", { name: "Markdown only" }),
    ).toBeTruthy();
    expect(screen.queryByText("Decision required")).toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Submit feedback",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // The document and the collection list — nothing else is fetched.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(DOCUMENT_URL);
    expect(fetchMock).toHaveBeenCalledWith("/api/collections");
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

        if (url === "/api/collections") {
          return collectionListResponse();
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ latestBatchId: null, batches: [] });
        }

        if (url.endsWith("/versions/1/restore") && init?.method === "POST") {
          return jsonResponse(restoredDocument, 200, '"pena-test-2"');
        }

        if (url.endsWith("/versions/1")) {
          return jsonResponse({
            slug: "review",
            collectionSlug: null,
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
                slug: "review",
                collectionSlug: null,
                title: "Second draft",
                version: 2,
                updatedAt: "2026-07-18T11:00:00.000Z",
              },
              {
                slug: "review",
                collectionSlug: null,
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

    render(<DocumentReviewPage documentSlug="review" />);

    await user.click(
      await screen.findByRole("button", { name: "Version 2" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Version history" }),
    ).toBeTruthy();
    const versionHistory = screen.getByRole("region", {
      name: "Version history",
    });
    const clockFormatter = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const versionTimes = [...versionHistory.querySelectorAll("time")].map(
      (time) => time.textContent,
    );
    expect(versionTimes[0]).toContain(
      clockFormatter.format(new Date("2026-07-18T11:00:00.000Z")),
    );
    expect(versionTimes[1]).toContain(
      clockFormatter.format(new Date("2026-07-18T10:00:00.000Z")),
    );

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
      `${DOCUMENT_URL}/versions/1/restore`,
      {
        method: "POST",
        headers: { "if-match": '"pena-test-1"' },
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(`${DOCUMENT_URL}/versions`);
    expect(fetchMock).toHaveBeenCalledWith(`${DOCUMENT_URL}/versions/1`);
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
        String(input) === "/api/collections"
          ? collectionListResponse()
          : String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : jsonResponse(documentResponse),
      ),
    );

    render(<DocumentReviewPage documentSlug="review" />);

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

      if (url === DOCUMENT_URL) {
        documentFetchCount += 1;
        return documentFetchCount === 1
          ? jsonResponse(documentResponse)
          : refreshResponse;
      }

      return collectionListResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentReviewPage documentSlug="review" />);

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
        String(input) === "/api/collections"
          ? collectionListResponse()
          : String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : jsonResponse(documentResponse),
      ),
    );
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="review" />);

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

  it("moves a root document into a collection", async () => {
    let currentDocument = documentResponse;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections") {
          return collectionListResponse([researchCollection]);
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ latestBatchId: null, batches: [] });
        }

        if (url === `${DOCUMENT_URL}/move` && init?.method === "POST") {
          currentDocument = { ...documentResponse, collectionSlug: "research" };
          return jsonResponse(
            { ...currentDocument, excerpt: "" },
            200,
            '"pena-test-2"',
          );
        }

        return jsonResponse(currentDocument);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="review" />);

    await user.click(await screen.findByRole("button", { name: "Move" }));
    const destination = screen.getByRole("combobox", {
      name: "Destination collection",
    }) as HTMLSelectElement;
    // The document already sits at the root, so only collections are offered.
    expect(
      [...destination.options].map((option) => [option.value, option.text]),
    ).toEqual([["research", "Research"]]);
    expect(destination.value).toBe("research");
    await user.click(screen.getByRole("button", { name: "Move document" }));

    expect(await screen.findByText("Moved to Research.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`${DOCUMENT_URL}/move`, {
      method: "POST",
      // The move is conditional on the exact document state that was loaded.
      headers: {
        "content-type": "application/json",
        "if-match": '"pena-test-1"',
      },
      body: JSON.stringify({ collectionSlug: "research" }),
    });
    // The URL stays the same, so the page reloads the document in place.
    expect(
      screen.getByRole("link", { name: "Research" }).getAttribute("href"),
    ).toBe("/collections/research");
    expect(
      screen.queryByRole("combobox", { name: "Destination collection" }),
    ).toBeNull();
  });

  it("moves a filed document back to the root", async () => {
    let currentDocument = {
      ...documentResponse,
      collectionSlug: "research" as string | null,
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections") {
          return collectionListResponse([
            { ...researchCollection, documentCount: 1 },
            writingCollection,
          ]);
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ latestBatchId: null, batches: [] });
        }

        if (url === `${DOCUMENT_URL}/move` && init?.method === "POST") {
          currentDocument = { ...documentResponse, collectionSlug: null };
          return jsonResponse(
            { ...currentDocument, excerpt: "" },
            200,
            '"pena-test-2"',
          );
        }

        return jsonResponse(currentDocument);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="review" />);

    await user.click(await screen.findByRole("button", { name: "Move" }));
    const destination = screen.getByRole("combobox", {
      name: "Destination collection",
    }) as HTMLSelectElement;
    // Root comes first; the current collection is not a destination.
    expect(
      [...destination.options].map((option) => [option.value, option.text]),
    ).toEqual([
      ["", "Root"],
      ["writing", "Writing"],
    ]);
    expect(destination.value).toBe("");
    await user.click(screen.getByRole("button", { name: "Move document" }));

    expect(await screen.findByText("Moved to the root.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`${DOCUMENT_URL}/move`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": '"pena-test-1"',
      },
      body: JSON.stringify({ collectionSlug: null }),
    });
    expect(screen.queryByRole("link", { name: "Research" })).toBeNull();
  });

  it("reports a failed move without leaving the page", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections") {
          return collectionListResponse([researchCollection]);
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ latestBatchId: null, batches: [] });
        }

        if (url === `${DOCUMENT_URL}/move` && init?.method === "POST") {
          return jsonResponse(
            { error: 'No collection exists with slug "research".' },
            404,
          );
        }

        return jsonResponse(documentResponse);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="review" />);

    await user.click(await screen.findByRole("button", { name: "Move" }));
    await user.click(screen.getByRole("button", { name: "Move document" }));

    expect(
      await screen.findByText('No collection exists with slug "research".'),
    ).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Review" })).toHaveLength(1);
  });

  it("hides the move action when there is nowhere to move to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/collections"
          ? collectionListResponse()
          : String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : jsonResponse(documentResponse),
      ),
    );

    render(<DocumentReviewPage documentSlug="review" />);

    await screen.findByRole("button", { name: "Archive" });
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
  });

  it("archives the document and returns to its collection", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign, pathname: "/docs/review" },
    });
    const filedDocument = { ...documentResponse, collectionSlug: "research" };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/collections") {
          return collectionListResponse([researchCollection]);
        }

        if (url.endsWith("/feedback")) {
          return jsonResponse({ latestBatchId: null, batches: [] });
        }

        if (url === DOCUMENT_URL && init?.method === "PATCH") {
          return jsonResponse(
            {
              ...filedDocument,
              archivedAt: "2026-07-19T10:00:00.000Z",
              excerpt: "",
            },
            200,
            '"pena-test-2"',
          );
        }

        return jsonResponse(filedDocument);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="review" />);

    await user.click(await screen.findByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/collections/research"),
    );
    expect(fetchMock).toHaveBeenCalledWith(DOCUMENT_URL, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": '"pena-test-1"',
      },
      body: JSON.stringify({ status: "archived" }),
    });
  });

  it("archives a root document and returns to the dashboard", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign, pathname: "/docs/review" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/collections"
          ? collectionListResponse()
          : String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : init?.method === "PATCH"
          ? jsonResponse(
              {
                ...documentResponse,
                archivedAt: "2026-07-19T10:00:00.000Z",
                excerpt: "",
              },
              200,
              '"pena-test-2"',
            )
          : jsonResponse(documentResponse),
      ),
    );
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="review" />);

    await user.click(await screen.findByRole("button", { name: "Archive" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("outlines the document and links back through its collections", async () => {
    const nestedCollection = {
      ...writingCollection,
      slug: "payments",
      name: "Payments",
      parentSlug: "research",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/collections"
          ? collectionListResponse([
              { ...researchCollection, childCount: 1 },
              nestedCollection,
            ])
          : String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : jsonResponse({ ...documentResponse, collectionSlug: "payments" }),
      ),
    );

    render(<DocumentReviewPage documentSlug="review" />);

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

    // The breadcrumb walks from the root through every ancestor collection.
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    const crumbs = [...breadcrumb.querySelectorAll("a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]);
    expect(crumbs).toEqual([
      ["All documents", "/"],
      ["Research", "/collections/research"],
      ["Payments", "/collections/payments"],
    ]);
    // The archive link in the utility bar is scoped to the same collection.
    expect(
      screen.getByRole("link", { name: "Archive" }).getAttribute("href"),
    ).toBe("/archive?collection=payments");
  });

  it("links a root document straight back to the dashboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/collections"
          ? collectionListResponse()
          : String(input).endsWith("/feedback")
          ? jsonResponse({ latestBatchId: null, batches: [] })
          : jsonResponse(documentResponse),
      ),
    );

    render(<DocumentReviewPage documentSlug="review" />);

    await screen.findByRole("heading", { name: "Review" });
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    const crumbs = [...breadcrumb.querySelectorAll("a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]);
    expect(crumbs).toEqual([["All documents", "/"]]);
    expect(
      screen.getByRole("link", { name: "Archive" }).getAttribute("href"),
    ).toBe("/archive");
  });
});

function collectionListResponse(
  collections: unknown[] = [],
): Response {
  return jsonResponse({ collections });
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
