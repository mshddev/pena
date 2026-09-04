// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "./HomePage";

const COLLECTIONS = [
  {
    slug: "research",
    name: "Research",
    parentSlug: null,
    documentCount: 1,
    childCount: 1,
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
  },
  {
    slug: "papers",
    name: "Papers",
    parentSlug: "research",
    documentCount: 1,
    childCount: 0,
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
  },
];

const DOCUMENTS = [
  {
    slug: "review",
    collectionSlug: null,
    version: 1,
    updatedAt: "2026-07-18T10:00:00.000Z",
    archivedAt: null,
    title: "Reviewing the release",
    excerpt: "What has to be true before we ship on Friday.",
  },
  {
    slug: "architecture-notes",
    collectionSlug: "research",
    version: 3,
    updatedAt: "2026-07-17T10:00:00.000Z",
    archivedAt: null,
    title: "Architecture Notes",
    excerpt: "The storage layer owns migrations; nothing above it does.",
  },
  {
    slug: "caching-paper",
    collectionSlug: "papers",
    version: 2,
    updatedAt: "2026-07-16T10:00:00.000Z",
    archivedAt: null,
    title: "Caching Paper",
    excerpt: "Request caching with a TTL keeps the tail latency down.",
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("collection home", () => {
  it("shows root documents and root collections as folders", async () => {
    stubLibrary();

    render(<HomePage collectionSlug={null} />);

    expect(
      await screen.findByRole("heading", { name: "All documents" }),
    ).toBeTruthy();
    expect(
      await screen.findByText("1 document and 1 collection"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Review/ }).getAttribute("href"),
    ).toBe("/docs/review");
    // Documents filed in collections stay behind their folder.
    expect(
      screen.queryByRole("link", { name: /Architecture Notes/ }),
    ).toBeNull();
    // The folder counts everything nested inside it.
    expect(
      screen.getByRole("link", { name: /Research/ }).getAttribute("href"),
    ).toBe("/collections/research");
    expect(screen.getByText("2 documents · 1 collection")).toBeTruthy();
  });

  it("opens a collection like a folder with its path", async () => {
    stubLibrary();

    render(<HomePage collectionSlug="papers" />);

    expect(
      await screen.findByRole("heading", { name: "Papers" }),
    ).toBeTruthy();
    expect(await screen.findByText("1 document")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Caching Paper/ }).getAttribute("href"),
    ).toBe("/docs/caching-paper");
    expect(screen.queryByRole("link", { name: /^Review/ })).toBeNull();

    const breadcrumb = screen.getByRole("navigation", {
      name: "Collection path",
    });
    const crumbs = [...breadcrumb.querySelectorAll("a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]);
    expect(crumbs).toEqual([
      ["All documents", "/"],
      ["Research", "/collections/research"],
      ["Papers", "/collections/papers"],
    ]);
  });

  it("searches into nested collections and labels each match", async () => {
    stubLibrary();
    const user = userEvent.setup();

    render(<HomePage collectionSlug="research" />);

    await screen.findByRole("link", { name: /Architecture Notes/ });
    await user.type(
      screen.getByRole("searchbox", { name: "Search documents" }),
      "caching",
    );

    expect(screen.getByRole("link", { name: /Caching Paper/ })).toBeTruthy();
    expect(screen.getByText("Research / Papers")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /Architecture Notes/ }),
    ).toBeNull();
    // Documents outside the folder are not searched.
    expect(screen.queryByRole("link", { name: /^Review/ })).toBeNull();
  });

  it("searches every document from the root", async () => {
    stubLibrary();
    const user = userEvent.setup();

    render(<HomePage collectionSlug={null} />);

    await screen.findByRole("link", { name: /Review/ });
    await user.type(
      screen.getByRole("searchbox", { name: "Search documents" }),
      "migrations",
    );

    expect(screen.getByRole("link", { name: /Architecture Notes/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Review/ })).toBeNull();
  });

  it("titles entries with explicit document titles", async () => {
    stubLibrary();

    render(<HomePage collectionSlug={null} />);

    expect(await screen.findByText("Reviewing the release")).toBeTruthy();
    expect(
      screen.getByText("What has to be true before we ship on Friday."),
    ).toBeTruthy();
    // The stable slug remains in the URL rather than replacing the title.
    expect(screen.queryByText("Review")).toBeNull();
  });

  it("leaves the archive to the utility bar", async () => {
    stubLibrary();

    render(<HomePage collectionSlug="research" />);

    await screen.findByText("Architecture Notes");
    expect(
      screen.queryByRole("link", { name: "Archived documents" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Archive" }).getAttribute("href"),
    ).toBe("/archive?collection=research");
  });

  it("counts feedback per document", async () => {
    stubLibrary({
      latestBatchId: 1,
      batches: [
        {
          id: 1,
          submittedAt: new Date().toISOString(),
          comments: [
            {
              selectedText: "Add request caching",
              comment: "Needs a cache TTL.",
              contextBefore: "",
              contextAfter: "",
            },
          ],
        },
      ],
    });

    render(<HomePage collectionSlug={null} />);

    expect(
      await screen.findByText(
        "1 document and 1 collection · 1 with recent feedback",
      ),
    ).toBeTruthy();
    expect((await screen.findAllByText("1 note")).length).toBe(1);
  });

  it("onboards when nothing has been published yet", async () => {
    stubLibrary({ documents: [], collections: [] });

    render(<HomePage collectionSlug={null} />);

    expect(
      await screen.findByRole("heading", {
        name: "Publish your first document",
      }),
    ).toBeTruthy();
    expect(screen.getByText("publish this plan to Pena")).toBeTruthy();
    expect(screen.getByText("Send back")).toBeTruthy();
  });

  it("links to collection management", async () => {
    stubLibrary();

    render(<HomePage collectionSlug={null} />);

    await screen.findByText("Reviewing the release");
    expect(
      screen
        .getByRole("link", { name: "Manage collections" })
        .getAttribute("href"),
    ).toBe("/collections");
  });

  it("shows a 404 for a collection that does not exist", async () => {
    stubLibrary();

    render(<HomePage collectionSlug="nowhere" />);

    expect(
      await screen.findByRole("heading", { name: "Collection not found" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Return to the dashboard" })
        .getAttribute("href"),
    ).toBe("/");
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("reports a failed load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    render(<HomePage collectionSlug={null} />);

    expect(await screen.findByText("Failed to fetch")).toBeTruthy();
  });
});

interface StubOptions {
  batches?: unknown[];
  collections?: unknown[];
  documents?: unknown[];
  latestBatchId?: number | null;
}

function stubLibrary({
  batches = [],
  collections = COLLECTIONS,
  documents = DOCUMENTS,
  latestBatchId = null,
}: StubOptions = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/collections") {
        return jsonResponse({ collections });
      }

      if (url === "/api/docs") {
        return jsonResponse({ documents });
      }

      if (url.endsWith("/feedback")) {
        return jsonResponse({ latestBatchId, batches });
      }

      return jsonResponse({}, 404);
    }),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
