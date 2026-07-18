import type { Components } from "react-markdown";

import { readAnnotationBlockId } from "./annotation";

export const annotatedMarkdownComponents: Components = {
  p: ({ node, ...props }) => (
    <p data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  h1: ({ node, ...props }) => (
    <h1 data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  h2: ({ node, ...props }) => (
    <h2 data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  h3: ({ node, ...props }) => (
    <h3 data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  h4: ({ node, ...props }) => (
    <h4 data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  ul: ({ node, ...props }) => (
    <ul data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  li: ({ node, ...props }) => (
    <li data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote
      data-annotation-block={readAnnotationBlockId(node)}
      {...props}
    />
  ),
  pre: ({ node, ...props }) => (
    <pre data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  table: ({ node, ...props }) => (
    <table data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  th: ({ node, ...props }) => (
    <th data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
  td: ({ node, ...props }) => (
    <td data-annotation-block={readAnnotationBlockId(node)} {...props} />
  ),
};
