import {
  useEffect,
  useLayoutEffect,
  useRef,
  type SyntheticEvent,
} from "react";

import {
  HTML_FRAME_SANDBOX,
  fitFrameToContent,
  openLinkInNewTab,
  readInitialFrameHeight,
  routeFrameLinks,
  scrollFrameSidewaysOnly,
  scrollToReadingPosition,
} from "../html-frame";

interface HtmlDocumentFrameProps {
  content: string;
  title: string;
  /** Runs for every document the frame loads, including after a republish. */
  onDocumentLoad?: (frameDocument: Document) => void;
}

/**
 * Renders an HTML document as the complete page it is, scripts included,
 * in a frame that grows with its content.
 */
export function HtmlDocumentFrame({
  content,
  title,
  onDocumentLoad,
}: HtmlDocumentFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const onDocumentLoadRef = useRef(onDocumentLoad);

  useLayoutEffect(() => {
    onDocumentLoadRef.current = onDocumentLoad;
  });

  // The fitter owns the height from here on, so React never sets it.
  useLayoutEffect(() => {
    const frame = frameRef.current;

    if (frame) {
      frame.style.height = `${readInitialFrameHeight()}px`;
    }
  }, []);

  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  function handleLoad(event: SyntheticEvent<HTMLIFrameElement>): void {
    const frame = event.currentTarget;
    const frameDocument = frame.contentDocument;

    detachRef.current?.();
    detachRef.current = null;

    if (!frameDocument) {
      return;
    }

    scrollFrameSidewaysOnly(frameDocument);
    const stopFitting = fitFrameToContent(frame);
    const stopRouting = routeFrameLinks(frameDocument, {
      openLink: openLinkInNewTab,
      scrollTo: scrollToReadingPosition,
    });

    detachRef.current = () => {
      stopFitting();
      stopRouting();
    };
    onDocumentLoadRef.current?.(frameDocument);
  }

  return (
    <iframe
      className="html-document-frame"
      ref={frameRef}
      sandbox={HTML_FRAME_SANDBOX}
      srcDoc={content}
      title={title}
      onLoad={handleLoad}
    />
  );
}
