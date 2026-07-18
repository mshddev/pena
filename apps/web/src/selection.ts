import type { CommentInput } from "@pena/contracts";

export type SelectedPassage = Omit<CommentInput, "comment">;

const CONTEXT_LENGTH = 120;

export function readSelection(
  root: HTMLElement,
  selection: Selection | null,
): SelectedPassage | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);

  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }

  const rawSelectedText = readRangeText(range);
  const selectedText = rawSelectedText.trim();

  if (!selectedText) {
    return null;
  }

  return readPassageAroundRange(root, range, selectedText);
}

export function readElementPassage(
  root: HTMLElement,
  element: HTMLElement,
): SelectedPassage | null {
  if (!root.contains(element)) {
    return null;
  }

  const selectedText = element.innerText.trim();

  if (!selectedText) {
    return null;
  }

  const range = window.document.createRange();
  range.selectNodeContents(element);

  return readPassageAroundRange(root, range, selectedText);
}

function readPassageAroundRange(
  root: HTMLElement,
  range: Range,
  selectedText: string,
): SelectedPassage {
  const precedingRange = window.document.createRange();
  precedingRange.selectNodeContents(root);
  precedingRange.setEnd(range.startContainer, range.startOffset);

  const followingRange = window.document.createRange();
  followingRange.selectNodeContents(root);
  followingRange.setStart(range.endContainer, range.endOffset);

  return {
    selectedText,
    contextBefore: readRangeText(precedingRange).slice(-CONTEXT_LENGTH),
    contextAfter: readRangeText(followingRange).slice(0, CONTEXT_LENGTH),
  };
}

function readRangeText(range: Range): string {
  const contents = range.cloneContents();
  contents
    .querySelectorAll("[data-pena-annotation]")
    .forEach((annotation) => annotation.remove());
  return contents.textContent ?? "";
}

export function findTextRange(
  root: HTMLElement,
  selectedText: string,
  exactStart?: number,
): Range | null {
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let fullText = "";

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;

    if (textNode.parentElement?.closest("[data-pena-annotation]")) {
      continue;
    }

    textNodes.push(textNode);
    fullText += textNode.data;
  }

  const matchStart =
    exactStart === undefined ? fullText.indexOf(selectedText) : exactStart;

  if (
    matchStart < 0 ||
    fullText.slice(matchStart, matchStart + selectedText.length) !== selectedText
  ) {
    return null;
  }

  const matchEnd = matchStart + selectedText.length;
  let traversedLength = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const textNode of textNodes) {
    const nodeEnd = traversedLength + textNode.length;

    if (!startNode && matchStart <= nodeEnd) {
      startNode = textNode;
      startOffset = matchStart - traversedLength;
    }

    if (matchEnd <= nodeEnd) {
      endNode = textNode;
      endOffset = matchEnd - traversedLength;
      break;
    }

    traversedLength = nodeEnd;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = window.document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

export function readTextOffset(
  root: HTMLElement,
  range: Range,
  selectedText: string,
): number | null {
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }

  const rawSelectedText = readRangeText(range);
  const leadingOffset = rawSelectedText.indexOf(selectedText);

  if (leadingOffset === -1) {
    return null;
  }

  const precedingRange = window.document.createRange();
  precedingRange.selectNodeContents(root);
  precedingRange.setEnd(range.startContainer, range.startOffset);

  return readRangeText(precedingRange).length + leadingOffset;
}
