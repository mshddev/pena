// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReviewPage } from "./DocumentReviewPage";

// Excalidraw draws on a <canvas> jsdom cannot provide, so the canvas stands
// in with the elements a scene converts to and a camera at the origin.
const canvas = vi.hoisted(() => ({
  elements: [
    { id: "backend", type: "frame", x: -20, y: -20, width: 400, height: 120, name: "Backend" },
    { id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
    { id: "api-label", type: "text", x: 30, y: 15, width: 40, height: 20, text: "API", containerId: "api" },
    { id: "db", type: "ellipse", x: 200, y: 0, width: 100, height: 50 },
  ],
  showBounds: vi.fn(),
  /** What the canvas serializes to; a test changes it to stand for an edit. */
  content: "",
  version: "v1",
  /** Lets a test report a change, as Excalidraw does after each edit. */
  reportChange: null as (() => void) | null,
}));

vi.mock("./components/ExcalidrawCanvas", async () => {
  const { useEffect } = await import("react");

  return {
    default: function FakeExcalidrawCanvas({
      editable,
      onReady,
      onSceneChange,
      onViewportChange,
    }: {
      editable?: boolean;
      onReady?: (handle: unknown) => void;
      onSceneChange?: () => void;
      onViewportChange?: (viewport: unknown) => void;
    }) {
      useEffect(() => {
        onReady?.({
          getElements: () => canvas.elements,
          getViewport: () => ({ scrollX: 0, scrollY: 0, zoom: 1 }),
          showBounds: canvas.showBounds,
          fit: vi.fn(),
          zoomBy: vi.fn(),
          toContent: () => canvas.content,
          readSceneVersion: () => canvas.version,
          isAsLaidOut: () => canvas.version === "v1",
        });
        canvas.reportChange = onSceneChange ?? null;
        onSceneChange?.();
        onViewportChange?.({ scrollX: 0, scrollY: 0, zoom: 1 });
      }, [onReady, onSceneChange, onViewportChange]);

      return (
        <div
          data-testid={editable ? "excalidraw-editor" : "excalidraw"}
        />
      );
    },
  };
});

const scene = JSON.stringify({
  type: "excalidraw",
  elements: [
    { type: "rectangle", id: "api", x: 0, y: 0, width: 100, height: 50, label: { text: "API" } },
    { type: "ellipse", id: "db", x: 200, y: 0, width: 100, height: 50 },
    { type: "frame", id: "backend", children: ["api", "db"], name: "Backend" },
  ],
});

const canvasDocument = {
  slug: "architecture",
  collectionSlug: null,
  title: "Architecture",
  content: scene,
  format: "excalidraw",
  version: 1,
  updatedAt: "2026-10-04T10:00:00.000Z",
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
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  canvas.showBounds.mockReset();
});

describe("canvas review", () => {
  it("comments on a clicked element and submits its ids", async () => {
    const submittedBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/collections") {
          return jsonResponse({ collections: [] });
        }

        if (init?.method === "POST") {
          submittedBodies.push(String(init.body));
          return jsonResponse({ id: 1, submittedAt: "2026-10-04T10:01:00.000Z" }, 201);
        }

        return jsonResponse(canvasDocument);
      }),
    );
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="architecture" />);

    await canvasReady();
    expect(window.EXCALIDRAW_ASSET_PATH).toBe("/excalidraw-assets/");
    expect(screen.getByText("Add an instruction or click an element to comment.")).toBeTruthy();

    // A click on the label lands on its shape.
    click(50, 25);

    expect(screen.getByText("API", { selector: "blockquote" })).toBeTruthy();
    await user.type(screen.getByLabelText("Your comment"), "Split auth out.");
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    expect(screen.getByRole("button", { name: "Edit comment 1" })).toBeTruthy();

    // Clicking the commented element again edits the same draft.
    click(10, 10);
    expect(
      (screen.getByLabelText("Update your note") as HTMLTextAreaElement).value,
    ).toBe("Split auth out.");
    await user.click(screen.getByRole("button", { name: "Cancel edit" }));

    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await screen.findByText(/submitted\. Ask Claude/);

    expect(JSON.parse(submittedBodies[0] ?? "{}").comments).toEqual([
      {
        selectedText: "API",
        comment: "Split auth out.",
        contextBefore: "",
        contextAfter: "",
        target: {
          elementIds: ["api"],
          bounds: { x: 0, y: 0, width: 100, height: 50 },
        },
      },
    ]);
  });

  it("comments on an area dragged with Shift, and lists frames in the outline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/collections"
          ? jsonResponse({ collections: [] })
          : jsonResponse(canvasDocument),
      ),
    );
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="architecture" />);

    await canvasReady();

    const surface = canvasSurface();
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: -10, clientY: -10, shiftKey: true });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 150, clientY: 80 });
    fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX: 320, clientY: 80 });

    expect(screen.getByText("API, Ellipse", { selector: "blockquote" })).toBeTruthy();
    await user.keyboard("{Escape}");

    fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 500, clientY: 300, shiftKey: true });
    fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX: 560, clientY: 340 });

    expect(screen.getByText("Empty area", { selector: "blockquote" })).toBeTruthy();

    const frameLink = await screen.findByRole("link", { name: "Backend" });
    await user.click(frameLink);

    await waitFor(() =>
      expect(canvas.showBounds).toHaveBeenCalledWith(
        { x: -20, y: -20, width: 400, height: 120 },
        { fit: true },
      ),
    );
    expect(window.location.hash).toBe("#pena-section-0");
  });

  it("treats a two-finger pinch as zooming, not a click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/collections"
          ? jsonResponse({ collections: [] })
          : jsonResponse(canvasDocument),
      ),
    );

    render(<DocumentReviewPage documentSlug="architecture" />);

    await canvasReady();

    const surface = canvasSurface();
    const touch = { button: 0, pointerType: "touch", clientX: 50, clientY: 25 };
    fireEvent.pointerDown(surface, { ...touch, pointerId: 11, isPrimary: true });
    fireEvent.pointerDown(surface, { ...touch, pointerId: 12, isPrimary: false });
    fireEvent.pointerUp(surface, { ...touch, pointerId: 12 });
    fireEvent.pointerUp(surface, { ...touch, pointerId: 11 });

    expect(document.querySelector(".canvas-comment-popover")).toBeNull();

    // The next single tap is a click again.
    fireEvent.pointerDown(surface, { ...touch, pointerId: 13, isPrimary: true });
    fireEvent.pointerUp(surface, { ...touch, pointerId: 13 });

    expect(screen.getByText("API", { selector: "blockquote" })).toBeTruthy();
  });

  it("explains a scene it cannot read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/collections"
          ? jsonResponse({ collections: [] })
          : jsonResponse({ ...canvasDocument, content: "{}" }),
      ),
    );

    render(<DocumentReviewPage documentSlug="architecture" />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      'This canvas could not be read: Excalidraw content must be a scene object with "type": "excalidraw".',
    );
  });
});

describe("canvas editing", () => {
  function editFetchMock() {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/collections") {
        return jsonResponse({ collections: [] });
      }

      if (init?.method === "PUT") {
        return jsonResponse({ ...canvasDocument, content: undefined, version: 2 });
      }

      return jsonResponse(canvasDocument);
    });
  }

  it("publishes the scene the reader drew as the next version", async () => {
    const fetchMock = editFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    canvas.content = '{"type":"excalidraw","elements":[]}';
    canvas.version = "v1";
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="architecture" />);

    await canvasReady();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByTestId("excalidraw-editor");

    // Loading the scene is not an edit; what the reader draws after
    // touching the canvas is.
    fireEvent.pointerDown(editor);
    canvas.content = '{"type":"excalidraw","elements":[{"id":"new"}]}';
    canvas.version = "v2";
    act(() => canvas.reportChange?.());

    // A drawn change is unsaved work, so leaving it takes a deliberate
    // discard.
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save version" }));

    expect(await screen.findByText("Saved your edit as version 2.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/docs/architecture", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "if-match": '"pena-test-1"',
      },
      body: JSON.stringify({ title: "Architecture", content: canvas.content }),
    });
  });

  it("leaves a canvas the reader did not change without publishing", async () => {
    const fetchMock = editFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    canvas.content = '{"type":"excalidraw","elements":[]}';
    canvas.version = "v1";
    const user = userEvent.setup();

    render(<DocumentReviewPage documentSlug="architecture" />);

    await canvasReady();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.pointerDown(await screen.findByTestId("excalidraw-editor"));
    await user.click(screen.getByRole("button", { name: "Save version" }));

    await canvasReady();
    expect(screen.queryByTestId("excalidraw-editor")).toBeNull();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });
});

/** The zoom controls show once the canvas has reported its camera. */
async function canvasReady(): Promise<void> {
  await screen.findByRole("group", { name: "Zoom" });
}

function canvasSurface(): HTMLElement {
  const surface = document.querySelector<HTMLElement>(".canvas-document-surface");

  if (!surface) {
    throw new Error("The canvas surface is not rendered.");
  }

  return surface;
}

/** jsdom lays nothing out, so client coordinates are canvas coordinates. */
function click(clientX: number, clientY: number): void {
  const surface = canvasSurface();
  fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX, clientY });
  fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX, clientY });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", etag: '"pena-test-1"' },
  });
}
