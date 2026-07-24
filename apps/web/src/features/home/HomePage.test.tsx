// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "./HomePage";

const WORKSPACES = [
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
    documentCount: 1,
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
  },
];

const DOCUMENTS: Record<string, unknown[]> = {
  default: [
    {
      workspaceSlug: "default",
      slug: "review",
      version: 1,
      updatedAt: "2026-07-18T10:00:00.000Z",
      archivedAt: null,
      heading: "Reviewing the release",
      excerpt: "What has to be true before we ship on Friday.",
    },
  ],
  research: [
    {
      workspaceSlug: "research",
      slug: "architecture-notes",
      version: 3,
      updatedAt: "2026-07-17T10:00:00.000Z",
      archivedAt: null,
      heading: null,
      excerpt: "The storage layer owns migrations; nothing above it does.",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workspace home", () => {
  it("lists every workspace and its documents", async () => {
    stubLibrary();

    render(<HomePage workspaceSlug={null} />);

    expect(
      await screen.findByRole("heading", { name: "All workspaces" }),
    ).toBeTruthy();
    expect(
      await screen.findByText("2 documents across 2 workspaces"),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Default/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Review/ }).getAttribute("href"),
    ).toBe("/workspaces/default/documents/review");
    expect(
      screen
        .getByRole("link", { name: /Architecture Notes/ })
        .getAttribute("href"),
    ).toBe("/workspaces/research/documents/architecture-notes");
  });

  it("scopes the library to one workspace", async () => {
    stubLibrary();

    render(<HomePage workspaceSlug="research" />);

    expect(
      await screen.findByRole("heading", { name: "Research" }),
    ).toBeTruthy();
    expect(await screen.findByText("1 document")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Architecture Notes/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Review/ })).toBeNull();
  });

  it("filters documents from the search box", async () => {
    stubLibrary();
    const user = userEvent.setup();

    render(<HomePage workspaceSlug={null} />);

    await screen.findByRole("link", { name: /Review/ });
    await user.type(
      screen.getByRole("searchbox", { name: "Search documents" }),
      "architecture",
    );

    expect(screen.getByRole("link", { name: /Architecture Notes/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Review/ })).toBeNull();
  });

  it("titles an entry with the document's own heading", async () => {
    stubLibrary();

    render(<HomePage workspaceSlug={null} />);

    expect(await screen.findByText("Reviewing the release")).toBeTruthy();
    expect(
      screen.getByText("What has to be true before we ship on Friday."),
    ).toBeTruthy();
    // The slug is left to the URL rather than repeated above the heading.
    expect(screen.queryByText("Review")).toBeNull();

    // With no heading the slug is all there is to title the entry with.
    expect(screen.getByText("Architecture Notes")).toBeTruthy();
    expect(screen.queryByText("architecture-notes")).toBeNull();
  });

  it("finds a document by what it says", async () => {
    stubLibrary();
    const user = userEvent.setup();

    render(<HomePage workspaceSlug={null} />);

    await screen.findByText("Reviewing the release");
    await user.type(
      screen.getByRole("searchbox", { name: "Search documents" }),
      "migrations",
    );

    expect(screen.getByText("Architecture Notes")).toBeTruthy();
    expect(screen.queryByText("Reviewing the release")).toBeNull();
  });

  it("leaves the archive to the utility bar", async () => {
    stubLibrary();

    render(<HomePage workspaceSlug={null} />);

    await screen.findByText("Reviewing the release");
    expect(
      screen.queryByRole("link", { name: "Archived documents" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Archive" }).getAttribute("href"),
    ).toBe("/archive");
  });

  it("counts feedback per document", async () => {
    stubLibrary({
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

    render(<HomePage workspaceSlug={null} />);

    expect(
      await screen.findByText("2 documents across 2 workspaces · 2 with recent feedback"),
    ).toBeTruthy();
    expect((await screen.findAllByText("1 note")).length).toBe(2);
  });

  it("onboards when nothing has been published yet", async () => {
    stubLibrary({ documents: { default: [], research: [] } });

    render(<HomePage workspaceSlug={null} />);

    expect(
      await screen.findByRole("heading", {
        name: "Publish your first document",
      }),
    ).toBeTruthy();
    expect(screen.getByText("publish this plan to Pena")).toBeTruthy();
    expect(screen.getByText("Send back")).toBeTruthy();
  });

  it("switches scope from the page heading", async () => {
    stubLibrary();
    const user = userEvent.setup();

    render(<HomePage workspaceSlug={null} />);

    const trigger = await screen.findByRole("button", {
      name: "All workspaces",
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("link", { name: "Research1" }).getAttribute("href"),
    ).toBe("/workspaces/research");
  });

  it("reports a failed load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    render(<HomePage workspaceSlug={null} />);

    expect(await screen.findByText("Failed to fetch")).toBeTruthy();
  });
});

interface StubOptions {
  batches?: unknown[];
  documents?: Record<string, unknown[]>;
}

function stubLibrary({ batches = [], documents = DOCUMENTS }: StubOptions = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/workspaces") {
        return jsonResponse({ workspaces: WORKSPACES });
      }

      if (url.endsWith("/feedback")) {
        return jsonResponse({ batches });
      }

      const listMatch = /^\/api\/workspaces\/([^/]+)\/documents$/.exec(url);

      if (listMatch?.[1]) {
        return jsonResponse({ documents: documents[listMatch[1]] ?? [] });
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
