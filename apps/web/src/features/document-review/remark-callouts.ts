import type { Blockquote, Paragraph, Root } from "mdast";
import type { Node, Parent } from "unist";

const CALLOUT_MARKER =
  /^\[!(info|note|tip|important|warning|caution)\][ \t]*(?=\r?\n|$)/i;

/**
 * Pena documents historically used `[!info]` without the blockquote marker
 * required by GitHub alerts. Adapt that syntax into a blockquote while
 * retaining every original source position for feedback annotations.
 */
export function remarkPenaCallouts() {
  return (tree: Root) => {
    transformChildren(tree);
  };
}

function transformChildren(parent: Parent): void {
  parent.children = parent.children.map((child) => {
    if (isBlockquote(child)) {
      normalizeBlockquoteMarker(child);
      transformNestedChildren(child);
      return child;
    }

    if (isParagraph(child) && normalizeMarker(child)) {
      return {
        type: "blockquote",
        children: [child],
        position: child.position,
      } satisfies Blockquote;
    }

    if (isParent(child)) {
      transformChildren(child);
    }

    return child;
  });
}

function normalizeBlockquoteMarker(blockquote: Blockquote): void {
  for (const child of blockquote.children) {
    if (child.type === "paragraph" && normalizeMarker(child)) {
      break;
    }
  }
}

function transformNestedChildren(blockquote: Blockquote): void {
  for (const child of blockquote.children) {
    if (child.type === "blockquote") {
      normalizeBlockquoteMarker(child);
      transformNestedChildren(child);
    } else if (child.type !== "paragraph" && isParent(child)) {
      transformChildren(child);
    }
  }
}

function normalizeMarker(paragraph: Paragraph): boolean {
  const firstChild = paragraph.children[0];

  if (firstChild?.type !== "text") {
    return false;
  }

  const match = firstChild.value.match(CALLOUT_MARKER);

  if (!match) {
    return false;
  }

  const sourceType = match[1]?.toLowerCase();
  const alertMarker =
    sourceType === "info"
      ? "[!NOTE/Info]"
      : `[!${sourceType?.toUpperCase()}]`;

  firstChild.value = `${alertMarker}${firstChild.value.slice(match[0].length)}`;
  return true;
}

function isParagraph(node: Node): node is Paragraph {
  return node.type === "paragraph";
}

function isBlockquote(node: Node): node is Blockquote {
  return node.type === "blockquote";
}

function isParent(node: Node): node is Parent {
  return "children" in node && Array.isArray(node.children);
}
