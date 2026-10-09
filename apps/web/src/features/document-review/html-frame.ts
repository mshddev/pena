import {
  readNodeWindow,
  readTopBarBottom,
  toViewportRect,
} from "./frame-geometry";

/**
 * The frame runs the page's scripts with Pena's origin, which the page needs
 * to reach uploaded assets. The sandbox is no security boundary with both
 * flags set; it only stops a page from navigating the review page away.
 */
export const HTML_FRAME_SANDBOX = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-same-origin",
  "allow-scripts",
].join(" ");

const MIN_FRAME_HEIGHT = 320;
const READING_OFFSET = 24;
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/**
 * The height a page's content takes. The root's own box is the content
 * unless the page pins it to the viewport (`html { height: 100% }`), and
 * `scrollHeight` adds content overflowing that box; it never reports less
 * than the frame, so it only counts while something overflows. A sideways
 * scrollbar takes its height from the frame, so the frame adds it back.
 */
export function measureFrameContent(frameDocument: Document): number {
  const root = frameDocument.documentElement;
  const overflowHeight =
    root.scrollHeight > root.clientHeight ? root.scrollHeight : 0;
  const scrollbarHeight = Math.max(
    0,
    (frameDocument.defaultView?.innerHeight ?? root.clientHeight) -
      root.clientHeight,
  );

  return Math.ceil(
    Math.max(root.offsetHeight, overflowHeight) + scrollbarHeight,
  );
}

/**
 * Returns a function that sizes the frame to its content each time it runs.
 * A page sized from its own viewport (`min-height: 100vh` plus a margin)
 * overflows any frame by the same amount, so fitting it would never end. A
 * same-origin frame lays out as soon as it is resized, so each fit measures
 * again at once: a page still overflowing by as much as before grew with the
 * frame, not with its content, and that overflow stops counting.
 */
export function createFrameHeightFitter(
  measure: () => number,
  apply: (height: number) => void,
  initialHeight: number,
): () => void {
  let height = initialHeight;
  let viewportOverflow = 0;

  return function fit(): void {
    const content = measure();
    let next = content - viewportOverflow;

    // Growing the frame never shrinks a page, so a page that shrank below
    // the frame lost whatever was sized from the viewport.
    if (viewportOverflow > 0 && next < height - 1) {
      viewportOverflow = 0;
      next = content;
    }

    if (Math.abs(next - height) < 1) {
      return;
    }

    const overflowBefore = content - height;
    height = next;
    apply(next);

    // An overflow that shrank is converging; the next fit follows it.
    const overflowAfter = measure() - next;
    viewportOverflow =
      overflowAfter >= 1 && overflowAfter >= overflowBefore - 1
        ? overflowAfter
        : 0;
  };
}

/**
 * The frame grows to the page's height, so only sideways overflow scrolls
 * inside it, keeping a page wider than a narrow frame reachable. Inserted
 * first, so a page that sets its own root overflow still wins.
 */
export function scrollFrameSidewaysOnly(frameDocument: Document): void {
  const style = frameDocument.createElement("style");
  style.dataset.penaAnnotation = "";
  style.textContent = "html { overflow-y: hidden; }";
  frameDocument.head.prepend(style);
}

/**
 * Keeps the frame as tall as its page, so the review page scrolls as one.
 * Returns a function that stops watching.
 */
export function fitFrameToContent(frame: HTMLIFrameElement): () => void {
  const frameDocument = frame.contentDocument;
  const frameWindow = frameDocument ? readNodeWindow(frameDocument) : null;

  if (!frameDocument || !frameWindow) {
    return () => {};
  }

  const fit = createFrameHeightFitter(
    () => measureFrameContent(frameDocument),
    (height) => {
      frame.style.height = `${height}px`;
    },
    frame.getBoundingClientRect().height,
  );
  let scheduledFrame = 0;

  function scheduleFit(): void {
    if (scheduledFrame !== 0 || !frameWindow) {
      return;
    }

    scheduledFrame = frameWindow.requestAnimationFrame(() => {
      scheduledFrame = 0;
      fit();
    });
  }

  // Content reflows in the frame's realm, so its own observers watch it.
  // Mutations cover a pinned root whose overflow changes without a resize,
  // and captured load events cover images that arrive after the page.
  const ResizeObserverConstructor = frameWindow.ResizeObserver;
  const resizeObserver = ResizeObserverConstructor
    ? new ResizeObserverConstructor(scheduleFit)
    : null;
  const mutationObserver = new frameWindow.MutationObserver(scheduleFit);

  resizeObserver?.observe(frameDocument.documentElement);

  if (frameDocument.body) {
    resizeObserver?.observe(frameDocument.body);
  }

  mutationObserver.observe(frameDocument.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  frameDocument.addEventListener("load", scheduleFit, true);
  fit();

  return () => {
    resizeObserver?.disconnect();
    mutationObserver.disconnect();
    frameDocument.removeEventListener("load", scheduleFit, true);

    if (scheduledFrame !== 0) {
      frameWindow.cancelAnimationFrame(scheduledFrame);
    }
  };
}

interface FrameNavigationHandlers {
  openLink: (url: string) => void;
  scrollTo: (element: Element) => void;
}

/**
 * A `srcdoc` page resolves URLs against the review page's URL, so even
 * `#section`, or a form's `action`, would load Pena inside the frame.
 * Fragments scroll within the page, every other link opens in a new tab, and
 * a form stays put, since a mockup has nothing to submit to; a dialog form
 * still closes its dialog. Listening in the
 * bubble phase lets the page's own handlers claim an event first.
 */
export function routeFrameNavigation(
  frameDocument: Document,
  { openLink, scrollTo }: FrameNavigationHandlers,
): () => void {
  function handleClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }

    const link = readClosestLink(event.target);
    const href = link ? readLinkHref(link) : null;

    if (!link || href === null) {
      return;
    }

    if (link.hasAttribute("download") || /^\s*javascript:/i.test(href)) {
      return;
    }

    event.preventDefault();

    if (href.startsWith("#")) {
      const destination = findFragmentTarget(frameDocument, href.slice(1));

      if (destination) {
        scrollTo(destination);
      }

      return;
    }

    const url = resolveUrl(href, frameDocument.baseURI);

    if (url) {
      openLink(url);
    }
  }

  function handleSubmit(event: SubmitEvent): void {
    const form = event.target as HTMLFormElement;
    const submitter = event.submitter as HTMLButtonElement | null;

    // A dialog form closes its dialog instead of navigating.
    if ((submitter?.formMethod || form.method) === "dialog") {
      return;
    }

    event.preventDefault();
  }

  frameDocument.addEventListener("click", handleClick);
  frameDocument.addEventListener("submit", handleSubmit);

  return () => {
    frameDocument.removeEventListener("click", handleClick);
    frameDocument.removeEventListener("submit", handleSubmit);
  };
}

export function openLinkInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Scrolls the review page so an element, in Pena or in a frame, sits just
 * below the sticky utility bar, where a heading link lands.
 */
export function scrollToReadingPosition(element: Element): void {
  const rect = toViewportRect(
    element.getBoundingClientRect(),
    element,
    window.document,
  );
  const topBarBottom = readTopBarBottom();

  // Rounding up lands the element on the reading line rather than a
  // fraction of a pixel below it, where it would not count as active yet.
  window.scrollTo({
    top: Math.max(
      0,
      Math.ceil(window.scrollY + rect.top - topBarBottom - READING_OFFSET),
    ),
    behavior: "auto",
  });
}

/** Tall enough that a page sized to its viewport fills the screen. */
export function readInitialFrameHeight(): number {
  const topBarBottom = readTopBarBottom();

  return Math.max(MIN_FRAME_HEIGHT, window.innerHeight - topBarBottom);
}

/** An HTML link, or an SVG one using either `href` or `xlink:href`. */
function readClosestLink(target: EventTarget | null): Element | null {
  // The target belongs to the frame's realm, so `instanceof` would fail.
  const node = target as Node | null;
  const element =
    node?.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);

  return element?.closest("a[href], a[*|href]") ?? null;
}

function readLinkHref(link: Element): string | null {
  return (
    link.getAttribute("href") ?? link.getAttributeNS(XLINK_NAMESPACE, "href")
  );
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function findFragmentTarget(
  frameDocument: Document,
  fragment: string,
): Element | null {
  let id = fragment;

  try {
    id = decodeURIComponent(fragment);
  } catch {
    // Keep the raw fragment when it is not percent-encoded.
  }

  if (id === "" || id.toLowerCase() === "top") {
    return frameDocument.documentElement;
  }

  return (
    frameDocument.getElementById(id) ??
    frameDocument.getElementsByName(id)[0] ??
    null
  );
}
