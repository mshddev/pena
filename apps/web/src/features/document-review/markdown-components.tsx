import { isValidElement, type ReactNode } from "react";
import type { Components } from "react-markdown";

import { readAnnotationBlockId } from "./annotation";
import { MermaidDiagram } from "./MermaidDiagram";

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
    suffix?: string,
  ) =>
    namespace
      ? {
          "data-annotation-block": `${namespace}-${readAnnotationBlockId(node)}${suffix ? `-${suffix}` : ""}`,
        }
      : {};

  return {
    div: ({ node, className, ...props }) =>
      hasClass(className, "markdown-alert") ? (
        <aside
          className={className}
          role="note"
          {...annotationId(node, "callout")}
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
    details: ({ node, ...props }) => (
      <details {...annotationId(node)} {...props} />
    ),
    summary: ({ node, ...props }) => (
      <summary {...annotationId(node)} {...props} />
    ),
    pre: ({ node, children, ...props }) => {
      const mermaidSource = readMermaidSource(children);

      return mermaidSource === null ? (
        <pre {...annotationId(node)} {...props}>
          {children}
        </pre>
      ) : (
        <MermaidDiagram source={mermaidSource} {...annotationId(node)} />
      );
    },
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

function readMermaidSource(children: ReactNode): string | null {
  if (
    !isValidElement<{
      children?: ReactNode;
      className?: string;
    }>(children) ||
    !hasClass(children.props.className, "language-mermaid")
  ) {
    return null;
  }

  return readText(children.props.children).replace(/\n$/, "");
}

function readText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(readText).join("");
  }

  return "";
}
