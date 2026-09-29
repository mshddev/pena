// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFrameHeightFitter,
  measureFrameContent,
  routeFrameLinks,
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

describe("createFrameHeightFitter", () => {
  it("grows and shrinks with the content", () => {
    let content = 1_200;
    const applied: number[] = [];
    const fit = createFrameHeightFitter(
      () => content,
      (height) => applied.push(height),
      800,
      () => 0,
    );

    fit();
    content = 600;
    fit();
    fit();

    expect(applied).toEqual([1_200, 600]);
  });

  it("stops chasing a page that grows with its own frame", () => {
    let frameHeight = 800;
    let clock = 0;
    const applied: number[] = [];
    // `min-height: 100vh` plus the default 8px body margin on each side.
    let marginBelowContent = 16;
    const fit = createFrameHeightFitter(
      () => frameHeight + marginBelowContent,
      (height) => {
        frameHeight = height;
        applied.push(height);
      },
      800,
      () => clock,
    );

    for (let step = 0; step < 10; step += 1) {
      clock += 16;
      fit();
    }

    // Long after the last resize, the same echo still does not restart it.
    clock += 10_000;
    fit();

    expect(applied).toEqual([816, 832, 848]);

    // A real change to the content is still followed.
    marginBelowContent = 16 + 300;
    fit();

    expect(applied.at(-1)).toBe(848 + 316);
  });
});

describe("routeFrameLinks", () => {
  it("scrolls to fragments inside the page and opens other links in a new tab", () => {
    const { frameDocument, frameWindow } = appendFrame(`
      <a id="to-plans" href="#plans">Plans</a>
      <a id="to-docs" href="https://example.com/docs">Docs</a>
      <h2 id="plans">Plans</h2>
    `);
    const openLink = vi.fn();
    const scrollTo = vi.fn();
    routeFrameLinks(frameDocument, { openLink, scrollTo });

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
    routeFrameLinks(frameDocument, { openLink, scrollTo: vi.fn() });
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
});
