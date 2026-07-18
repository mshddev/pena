import type { Components } from "react-markdown";

import { readAnnotationBlockId } from "./annotation";

export function createAnnotatedMarkdownComponents(
  namespace: string,
): Components {
  const annotationId = (
    node:
      | {
          position?: {
            start?: {
              offset?: number;
              line?: number;
              column?: number;
            };
          };
        }
      | undefined,
  ) => `${namespace}-${readAnnotationBlockId(node)}`;

  return {
    p: ({ node, ...props }) => (
      <p data-annotation-block={annotationId(node)} {...props} />
    ),
    h1: ({ node, ...props }) => (
      <h1 data-annotation-block={annotationId(node)} {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 data-annotation-block={annotationId(node)} {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3 data-annotation-block={annotationId(node)} {...props} />
    ),
    h4: ({ node, ...props }) => (
      <h4 data-annotation-block={annotationId(node)} {...props} />
    ),
    ul: ({ node, ...props }) => (
      <ul data-annotation-block={annotationId(node)} {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol data-annotation-block={annotationId(node)} {...props} />
    ),
    li: ({ node, ...props }) => (
      <li data-annotation-block={annotationId(node)} {...props} />
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote data-annotation-block={annotationId(node)} {...props} />
    ),
    pre: ({ node, ...props }) => (
      <pre data-annotation-block={annotationId(node)} {...props} />
    ),
    table: ({ node, ...props }) => (
      <table data-annotation-block={annotationId(node)} {...props} />
    ),
    th: ({ node, ...props }) => (
      <th data-annotation-block={annotationId(node)} {...props} />
    ),
    td: ({ node, ...props }) => (
      <td data-annotation-block={annotationId(node)} {...props} />
    ),
  };
}
