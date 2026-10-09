/**
 * Client rects inside a same-origin frame are measured from that frame's
 * viewport. Moves one into the viewport of `viewportDocument`, where the
 * review stage lays out its markers and popovers. A rect already in that
 * document comes back unchanged.
 */
export function toViewportRect(
  rect: DOMRect,
  node: Node,
  viewportDocument: Document,
): DOMRect {
  let left = rect.left;
  let top = rect.top;
  let currentDocument = node.ownerDocument ?? (node as Document);

  while (currentDocument !== viewportDocument) {
    const frame = readFrameElement(currentDocument);

    if (!frame) {
      break;
    }

    const frameRect = frame.getBoundingClientRect();
    left += frameRect.left + frame.clientLeft;
    top += frameRect.top + frame.clientTop;
    currentDocument = frame.ownerDocument;
  }

  return new DOMRect(left, top, rect.width, rect.height);
}

/** The window a node belongs to, which differs from `window` inside a frame. */
export function readNodeWindow(node: Node): (Window & typeof globalThis) | null {
  const ownerDocument = node.ownerDocument ?? (node as Document);
  return ownerDocument.defaultView as (Window & typeof globalThis) | null;
}

function readFrameElement(ownerDocument: Document): Element | null {
  try {
    return ownerDocument.defaultView?.frameElement ?? null;
  } catch {
    // A cross-origin parent hides the frame element.
    return null;
  }
}

/**
 * The room kept at the top of the window for its fixed bar. The review bar
 * floats over the page and can come back at any moment, so its full height
 * counts even while it is slid away: reading positions stay steady as it
 * comes and goes, and nothing placed below the reserve is covered when it
 * returns. Elsewhere it is where the utility bar ends.
 */
export function readTopBarReserve(): number {
  const reviewBar = window.document.querySelector<HTMLElement>(".review-bar");

  if (reviewBar) {
    return reviewBar.offsetHeight;
  }

  return (
    window.document
      .querySelector<HTMLElement>(".utility-bar")
      ?.getBoundingClientRect().bottom ?? 0
  );
}
