import type { ComponentProps } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";

import { remarkPenaCallouts } from "./remark-callouts";

const remarkPlugins: NonNullable<
  ComponentProps<typeof ReactMarkdown>["remarkPlugins"]
> = [
  remarkGfm,
  remarkPenaCallouts,
  [remarkAlert, { legacyTitle: true }],
];

interface MarkdownContentProps {
  children: string;
  components?: Components;
}

export function MarkdownContent({
  children,
  components,
}: MarkdownContentProps) {
  return (
    <ReactMarkdown components={components} remarkPlugins={remarkPlugins}>
      {children}
    </ReactMarkdown>
  );
}
