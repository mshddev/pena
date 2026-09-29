import type { CommentInput } from "@pena/contracts";

export type SelectedPassage = Omit<CommentInput, "comment">;

export type PassageContext = Pick<
  SelectedPassage,
  "contextBefore" | "contextAfter"
>;

const CONTEXT_LENGTH = 120;

/**
 * Text a reader never sees: Pena's own annotation chrome, and the source of
 * scripts and styles (an HTML page's, or the <style> inside a Mermaid SVG).
 * Reading and finding a passage must skip the same text, or offsets drift.
 */
const HIDDEN_TEXT_SELECTOR =
  "[data-pena-annotation], script, style, noscript, template";

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

  const range = root.ownerDocument.createRange();
  range.selectNodeContents(element);

  return readPassageAroundRange(root, range, selectedText);
}

function readPassageAroundRange(
  root: HTMLElement,
  range: Range,
  selectedText: string,
): SelectedPassage {
  const precedingRange = root.ownerDocument.createRange();
  precedingRange.selectNodeContents(root);
  precedingRange.setEnd(range.startContainer, range.startOffset);

  const followingRange = root.ownerDocument.createRange();
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
    .querySelectorAll(HIDDEN_TEXT_SELECTOR)
    .forEach((hidden) => hidden.remove());
  return contents.textContent ?? "";
}

/**
 * Finds `selectedText` in `root`, at `exactStart` when given. A page's scripts
 * can change the text in front of a passage after it was read; with
 * `context`, a passage no longer at `exactStart` is looked up by the text
 * around it instead.
 */
export function findTextRange(
  root: HTMLElement,
  selectedText: string,
  exactStart?: number,
  context?: PassageContext,
): Range | null {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  const textNodes: Text[] = [];
  let fullText = "";

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;

    if (textNode.parentElement?.closest(HIDDEN_TEXT_SELECTOR)) {
      continue;
    }

    textNodes.push(textNode);
    fullText += textNode.data;
  }

  let matchStart =
    exactStart === undefined ? fullText.indexOf(selectedText) : exactStart;

  if (!isTextAt(fullText, selectedText, matchStart)) {
    if (!context || exactStart === undefined) {
      return null;
    }

    matchStart = findMovedPassage(fullText, selectedText, context, exactStart);

    if (matchStart < 0) {
      return null;
    }
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

  const range = root.ownerDocument.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function isTextAt(fullText: string, text: string, start: number): boolean {
  return start >= 0 && fullText.slice(start, start + text.length) === text;
}

/**
 * The occurrence of `selectedText` whose surroundings best match the context
 * it was read with, nearest its former start on a tie; -1 when none is left.
 */
function findMovedPassage(
  fullText: string,
  selectedText: string,
  { contextBefore, contextAfter }: PassageContext,
  formerStart: number,
): number {
  let bestStart = -1;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (
    let start = fullText.indexOf(selectedText);
    start !== -1;
    start = fullText.indexOf(selectedText, start + 1)
  ) {
    const end = start + selectedText.length;
    const score =
      countSharedEnding(fullText, start, contextBefore) +
      countSharedBeginning(fullText, end, contextAfter);
    const distance = Math.abs(start - formerStart);

    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestStart = start;
      bestScore = score;
      bestDistance = distance;
    }
  }

  return bestStart;
}

/** How many characters of `text` end where `fullText` reaches `end`. */
function countSharedEnding(fullText: string, end: number, text: string): number {
  let count = 0;

  while (
    count < text.length &&
    count < end &&
    fullText[end - 1 - count] === text[text.length - 1 - count]
  ) {
    count += 1;
  }

  return count;
}

/** How many characters of `text` begin where `fullText` reaches `start`. */
function countSharedBeginning(
  fullText: string,
  start: number,
  text: string,
): number {
  let count = 0;

  while (
    count < text.length &&
    start + count < fullText.length &&
    fullText[start + count] === text[count]
  ) {
    count += 1;
  }

  return count;
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

  const precedingRange = root.ownerDocument.createRange();
  precedingRange.selectNodeContents(root);
  precedingRange.setEnd(range.startContainer, range.startOffset);

  return readRangeText(precedingRange).length + leadingOffset;
}
