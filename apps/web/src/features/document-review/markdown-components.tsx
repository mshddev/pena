import type { Components } from "react-markdown";

import { readAnnotationBlockId } from "./annotation";

export function createAnnotatedMarkdownComponents(
  namespace: string,
): Components {
  return createMarkdownComponents(namespace);
}

export const markdownComponents = createMarkdownComponents();

function createMarkdownComponents(namespace?: string): Components {
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
  ) =>
    namespace
      ? { "data-annotation-block": `${namespace}-${readAnnotationBlockId(node)}` }
      : {};

  return {
    div: ({ node, className, ...props }) =>
      hasClass(className, "markdown-alert") ? (
        <aside
          className={className}
          role="note"
          {...annotationId(node)}
          {...props}
        />
      ) : (
        <div className={className} {...props} />
      ),
    p: ({ node, className, ...props }) =>
      hasClass(className, "markdown-alert-title") ? (
        <p className={className} data-pena-annotation {...props} />
      ) : (
        <p className={className} {...annotationId(node)} {...props} />
      ),
    h1: ({ node, ...props }) => (
      <h1 {...annotationId(node)} {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 {...annotationId(node)} {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3 {...annotationId(node)} {...props} />
    ),
    h4: ({ node, ...props }) => (
      <h4 {...annotationId(node)} {...props} />
    ),
    ul: ({ node, ...props }) => (
      <ul {...annotationId(node)} {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol {...annotationId(node)} {...props} />
    ),
    li: ({ node, ...props }) => (
      <li {...annotationId(node)} {...props} />
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote {...annotationId(node)} {...props} />
    ),
    pre: ({ node, ...props }) => (
      <pre {...annotationId(node)} {...props} />
    ),
    table: ({ node, ...props }) => (
      <table {...annotationId(node)} {...props} />
    ),
    th: ({ node, ...props }) => (
      <th {...annotationId(node)} {...props} />
    ),
    td: ({ node, ...props }) => (
      <td {...annotationId(node)} {...props} />
    ),
  };
}

function hasClass(className: string | undefined, expected: string): boolean {
  return className?.split(/\s+/).includes(expected) ?? false;
}
