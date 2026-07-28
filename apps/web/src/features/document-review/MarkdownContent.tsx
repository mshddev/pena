import type { ComponentProps } from "react";
import type { Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";
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

const alertTypes = ["note", "tip", "important", "warning", "caution"].join(
  "|",
);

const penaHtmlSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "svg", "path"],
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      [
        "className",
        "markdown-alert",
        new RegExp(`^markdown-alert-(?:${alertTypes})$`),
      ],
    ],
    p: [
      ...(defaultSchema.attributes?.p ?? []),
      ["className", "markdown-alert-title"],
    ],
    svg: [
      ["className", "octicon"],
      "viewBox",
      "width",
      "height",
      "ariaHidden",
    ],
    path: ["d"],
  },
};

const rehypePlugins: NonNullable<
  ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
> = [rehypeRaw, [rehypeSanitize, penaHtmlSchema]];

interface MarkdownContentProps {
  children: string;
  components?: Components;
}

export function MarkdownContent({
  children,
  components,
}: MarkdownContentProps) {
  return (
    <ReactMarkdown
      components={components}
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
    >
      {children}
    </ReactMarkdown>
  );
}
