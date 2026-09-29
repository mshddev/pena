import { readNodeWindow, toViewportRect } from "./frame-geometry";

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
/** A growth that lands this soon after a resize answers that resize. */
const RESIZE_ECHO_MS = 250;
const MAX_CHASED_GROWTHS = 3;
const READING_OFFSET = 24;

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
 * grows by the same amount after every resize, forever. After a few of those
 * echoes in a row the frame stops following that amount for good, while
 * still following any other change to the content.
 */
export function createFrameHeightFitter(
  measure: () => number,
  apply: (height: number) => void,
  initialHeight: number,
  now: () => number = () => performance.now(),
): () => void {
  let height = initialHeight;
  let lastAppliedAt = Number.NEGATIVE_INFINITY;
  let lastGrowth = 0;
  let chasedGrowths = 0;
  let echoGrowth: number | null = null;

  return function fit(): void {
    const next = measure();
    const growth = next - height;

    if (
      Math.abs(growth) < 1 ||
      (echoGrowth !== null && Math.abs(growth - echoGrowth) <= 1)
    ) {
      return;
    }

    const echoesResize =
      growth > 0 &&
      Math.abs(growth - lastGrowth) <= 1 &&
      now() - lastAppliedAt < RESIZE_ECHO_MS;
    chasedGrowths = echoesResize ? chasedGrowths + 1 : 0;
    lastGrowth = growth;

    if (chasedGrowths >= MAX_CHASED_GROWTHS) {
      echoGrowth = growth;
      return;
    }

    height = next;
    lastAppliedAt = now();
    apply(next);
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

interface FrameLinkHandlers {
  openLink: (url: string) => void;
  scrollTo: (element: Element) => void;
}

/**
 * A `srcdoc` page resolves links against the review page's URL, so even
 * `#section` would load Pena inside the frame. Fragments scroll within the
 * page and every other link opens in a new tab. Listening in the bubble
 * phase lets the page's own handlers claim a click first.
 */
export function routeFrameLinks(
  frameDocument: Document,
  { openLink, scrollTo }: FrameLinkHandlers,
): () => void {
  function handleClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }

    const link = readClosestLink(event.target);
    const href = link?.getAttribute("href");

    if (!link || href === null || href === undefined) {
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

    openLink(link.href);
  }

  frameDocument.addEventListener("click", handleClick);
  return () => frameDocument.removeEventListener("click", handleClick);
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
  const utilityBarBottom =
    window.document
      .querySelector<HTMLElement>(".utility-bar")
      ?.getBoundingClientRect().bottom ?? 0;

  // Rounding up lands the element on the reading line rather than a
  // fraction of a pixel below it, where it would not count as active yet.
  window.scrollTo({
    top: Math.max(
      0,
      Math.ceil(window.scrollY + rect.top - utilityBarBottom - READING_OFFSET),
    ),
    behavior: "auto",
  });
}

/** Tall enough that a page sized to its viewport fills the screen. */
export function readInitialFrameHeight(): number {
  const utilityBarBottom =
    window.document
      .querySelector<HTMLElement>(".utility-bar")
      ?.getBoundingClientRect().bottom ?? 0;

  return Math.max(MIN_FRAME_HEIGHT, window.innerHeight - utilityBarBottom);
}

function readClosestLink(target: EventTarget | null): HTMLAnchorElement | null {
  // The target belongs to the frame's realm, so `instanceof` would fail.
  const node = target as Node | null;
  const element =
    node?.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);

  return element?.closest<HTMLAnchorElement>("a[href]") ?? null;
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
