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
  slug: "review",
  content: DECISION_DOCUMENT,
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

      if (init?.method === "POST") {
        submittedBodies.push(String(init.body));
        return jsonResponse({
          id: "d2883d6f-09cb-4d96-bdbe-1085a12c2305",
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

    render(<DocumentReviewPage documentSlug="review" />);

    const apply = await screen.findByRole("button", { name: "Apply" });
    const skip = screen.getByRole("button", { name: "Skip" });

    expect(apply.getAttribute("aria-pressed")).toBe("false");
    expect(skip.getAttribute("aria-pressed")).toBe("false");

    await user.click(apply);
    expect(screen.getByText("1 decision ready to submit")).toBeTruthy();
    expect(apply.getAttribute("aria-pressed")).toBe("true");

    await user.click(apply);
    expect(
      screen.getByText("Choose a decision or select text to start."),
    ).toBeTruthy();

    await user.click(skip);
    expect(skip.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));

    await screen.findByText(
      "1 decision submitted. Ask Claude to read your Pena feedback.",
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
        String(input).endsWith("/feedback")
          ? jsonResponse({
              batches: [
                {
                  id: "0bc32cee-9f30-4551-82e8-61551d23cc81",
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

  it("fails the page when decision feedback cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ...documentResponse,
        content: "# Markdown only\n\nSelect this passage.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentReviewPage documentSlug="review" />);

    expect(
      await screen.findByRole("heading", { name: "Markdown only" }),
    ).toBeTruthy();
    expect(screen.queryByText("Decision required")).toBeNull();
    expect(
      screen.getByText("Select text in the document to start."),
    ).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
