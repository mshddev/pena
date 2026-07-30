import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";

type MarkdownImageProps = ComponentProps<"img"> & {
  "data-annotation-block"?: string;
};

export function MarkdownImage({
  alt,
  className,
  decoding,
  loading,
  onError,
  src,
  ...props
}: MarkdownImageProps) {
  const [failed, setFailed] = useState(!src);
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFailed(!src);
    setExpanded(false);
  }, [src]);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeLightbox();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  if (failed) {
    return (
      <span
        aria-label={alt || "Image unavailable"}
        className={joinClassNames("markdown-image-fallback", className)}
        role="img"
        {...readAnnotationProps(props)}
      >
        {alt ? `Image unavailable: ${alt}` : "Image unavailable"}
      </span>
    );
  }

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    setFailed(true);
    setExpanded(false);
    onError?.(event);
  };

  const closeLightbox = () => {
    setExpanded(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const lightbox =
    expanded && typeof document !== "undefined"
      ? createPortal(
          <div
            aria-label={
              alt ? `Enlarged image: ${alt}` : "Enlarged image"
            }
            aria-modal="true"
            className="image-lightbox"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeLightbox();
              }
            }}
            role="dialog"
          >
            <figure className="image-lightbox-panel">
              <button
                aria-label="Close enlarged image"
                className="image-lightbox-close"
                onClick={closeLightbox}
                ref={closeRef}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
              <img
                alt={alt ?? ""}
                className="image-lightbox-image"
                decoding="async"
                src={src}
                title={props.title}
              />
              {alt ? (
                <figcaption className="image-lightbox-caption">
                  {alt}
                </figcaption>
              ) : null}
            </figure>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        aria-label={
          alt ? `Enlarge image: ${alt}` : "Enlarge image"
        }
        className="markdown-image-trigger"
        onClick={() => setExpanded(true)}
        ref={triggerRef}
        type="button"
      >
        <img
          {...props}
          alt={alt ?? ""}
          className={joinClassNames("markdown-image", className)}
          decoding={decoding ?? "async"}
          loading={loading ?? "lazy"}
          onError={handleError}
          src={src}
        />
      </button>
      {lightbox}
    </>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function readAnnotationProps(
  props: Omit<
    MarkdownImageProps,
    "alt" | "className" | "decoding" | "loading" | "onError" | "src"
  >,
): Record<string, string> {
  const annotation = props["data-annotation-block"];

  return typeof annotation === "string"
    ? { "data-annotation-block": annotation }
    : {};
}
