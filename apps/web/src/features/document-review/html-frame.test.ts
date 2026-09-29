// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFrameHeightFitter,
  measureFrameContent,
  routeFrameNavigation,
  scrollFrameSidewaysOnly,
} from "./html-frame";

afterEach(() => {
  window.document.body.replaceChildren();
});

function rootSized(
  size: {
    offsetHeight: number;
    scrollHeight: number;
    clientHeight: number;
  },
  innerHeight?: number,
): Document {
  return {
    documentElement: size,
    defaultView: innerHeight === undefined ? null : { innerHeight },
  } as unknown as Document;
}

function appendFrame(html: string): {
  frame: HTMLIFrameElement;
  frameDocument: Document;
  frameWindow: Window & typeof globalThis;
} {
  const frame = window.document.createElement("iframe");
  window.document.body.append(frame);
  const frameDocument = frame.contentDocument as Document;
  frameDocument.body.innerHTML = html;

  return {
    frame,
    frameDocument,
    frameWindow: frame.contentWindow as Window & typeof globalThis,
  };
}

describe("measureFrameContent", () => {
  it("follows content shorter than the frame", () => {
    expect(
      measureFrameContent(
        rootSized({ offsetHeight: 200, scrollHeight: 800, clientHeight: 800 }),
      ),
    ).toBe(200);
  });

  it("counts content overflowing a root pinned to the viewport", () => {
    expect(
      measureFrameContent(
        rootSized({
          offsetHeight: 800,
          scrollHeight: 1_450.4,
          clientHeight: 800,
        }),
      ),
    ).toBe(1_451);
  });

  it("adds back the height a sideways scrollbar takes", () => {
    expect(
      measureFrameContent(
        rootSized(
          { offsetHeight: 900, scrollHeight: 900, clientHeight: 885 },
          900,
        ),
      ),
    ).toBe(915);
  });
});

describe("scrollFrameSidewaysOnly", () => {
  it("hides vertical overflow before the page's own styles", () => {
    const { frameDocument } = appendFrame("");
    const pageStyle = frameDocument.createElement("style");
    frameDocument.head.append(pageStyle);

    scrollFrameSidewaysOnly(frameDocument);

    const injected = frameDocument.head.firstElementChild;
    expect(injected?.textContent).toBe("html { overflow-y: hidden; }");
    expect(injected?.nextElementSibling).toBe(pageStyle);
  });
});

/**
 * A frame whose page measures `layout(frameHeight)`, laid out as soon as the
 * frame is resized, as a same-origin frame is.
 */
function fakeFrame(layout: (frameHeight: number) => number, height = 800) {
  const frame = { height, applied: [] as number[] };
  const fit = createFrameHeightFitter(
    () => layout(frame.height),
    (next) => {
      frame.height = next;
      frame.applied.push(next);
    },
    height,
  );
  // Every resize is observed and fits again, as the ResizeObserver does.
  const settle = () => {
    for (let pass = 0; pass < 20; pass += 1) {
      const before = frame.applied.length;
      fit();

      if (frame.applied.length === before) {
        return;
      }
    }

    throw new Error("The frame never settled.");
  };

  return { frame, settle };
}

describe("createFrameHeightFitter", () => {
  it("grows and shrinks with the content", () => {
    let content = 1_200;
    const { frame, settle } = fakeFrame(() => content);

    settle();
    content = 600;
    settle();

    expect(frame.applied).toEqual([1_200, 600]);
  });

  it("follows content that grows in equal steps", () => {
    // A staggered entrance: one 40px row at a time, then one more much later.
    let rows = 0;
    const { frame, settle } = fakeFrame(() => 200 + rows * 40, 200);

    for (let row = 0; row < 12; row += 1) {
      rows += 1;
      settle();
    }

    rows += 1;
    settle();

    expect(frame.height).toBe(200 + 13 * 40);
  });

  it("settles a page that grows with its own frame", () => {
    let content = 300;
    // `min-height: 100vh` plus the default 8px body margin on each side.
    const { frame, settle } = fakeFrame(
      (frameHeight) => Math.max(frameHeight, content) + 16,
    );

    settle();
    settle();

    expect(frame.applied).toEqual([816]);

    // Content that outgrows the viewport is followed, short of the margin
    // the viewport sizing adds.
    content = 1_500;
    settle();

    expect(frame.height).toBeGreaterThanOrEqual(1_500);
    expect(frame.height).toBeLessThanOrEqual(1_516);
    const settled = frame.applied.length;
    settle();
    expect(frame.applied).toHaveLength(settled);
  });

  it("stops at once for a page taller than its frame by a multiple", () => {
    const { frame, settle } = fakeFrame((frameHeight) => frameHeight * 2);

    settle();

    expect(frame.applied).toEqual([1_600]);
  });

  it("converges on a page only partly sized from its frame", () => {
    const { frame, settle } = fakeFrame(
      (frameHeight) => frameHeight / 2 + 400,
      600,
    );

    settle();

    expect(Math.abs(frame.height - 800)).toBeLessThan(2);
  });
});

describe("routeFrameNavigation", () => {
  it("scrolls to fragments inside the page and opens other links in a new tab", () => {
    const { frameDocument, frameWindow } = appendFrame(`
      <a id="to-plans" href="#plans">Plans</a>
      <a id="to-docs" href="https://example.com/docs">Docs</a>
      <h2 id="plans">Plans</h2>
    `);
    const openLink = vi.fn();
    const scrollTo = vi.fn();
    routeFrameNavigation(frameDocument, { openLink, scrollTo });

    const fragmentClick = new frameWindow.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    frameDocument.getElementById("to-plans")?.dispatchEvent(fragmentClick);
    const externalClick = new frameWindow.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    frameDocument.getElementById("to-docs")?.dispatchEvent(externalClick);

    expect(fragmentClick.defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(frameDocument.getElementById("plans"));
    expect(externalClick.defaultPrevented).toBe(true);
    expect(openLink).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("leaves clicks the page handles itself, downloads, and scripts alone", () => {
    const { frameDocument, frameWindow } = appendFrame(`
      <a id="routed" href="/settings">Settings</a>
      <a id="download" href="/report.csv" download>Report</a>
      <a id="script" href="javascript:void 0">Run</a>
    `);
    const openLink = vi.fn();
    routeFrameNavigation(frameDocument, { openLink, scrollTo: vi.fn() });
    frameDocument
      .getElementById("routed")
      ?.addEventListener("click", (event) => event.preventDefault());
    // Stands in for navigation, which jsdom does not implement.
    frameWindow.addEventListener("click", (event) => event.preventDefault());

    for (const id of ["routed", "download", "script"]) {
      frameDocument.getElementById(id)?.dispatchEvent(
        new frameWindow.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    }

    expect(openLink).not.toHaveBeenCalled();
  });

  it("opens SVG links, including xlink:href, against the page's base URL", () => {
    const { frameDocument, frameWindow } = appendFrame(`
      <svg>
        <a id="svg-link" href="https://example.com/chart"><text>Chart</text></a>
        <a id="xlink" xlink:href="/guide"><text>Guide</text></a>
      </svg>
    `);
    const openLink = vi.fn();
    routeFrameNavigation(frameDocument, { openLink, scrollTo: vi.fn() });

    for (const id of ["svg-link", "xlink"]) {
      frameDocument.getElementById(id)?.firstElementChild?.dispatchEvent(
        new frameWindow.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    }

    expect(openLink.mock.calls).toEqual([
      ["https://example.com/chart"],
      [new URL("/guide", frameDocument.baseURI).href],
    ]);
  });

  it("keeps a form submission from navigating the frame", () => {
    const { frameDocument, frameWindow } = appendFrame(`
      <form id="search" action="/login"><button>Sign in</button></form>
    `);
    routeFrameNavigation(frameDocument, { openLink: vi.fn(), scrollTo: vi.fn() });
    const submit = new frameWindow.Event("submit", {
      bubbles: true,
      cancelable: true,
    });

    frameDocument.getElementById("search")?.dispatchEvent(submit);

    expect(submit.defaultPrevented).toBe(true);
  });
});
