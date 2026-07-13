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

  const rawSelectedText = selection.toString();
  const selectedText = rawSelectedText.trim();

  if (!selectedText) {
    return null;
  }

  const precedingRange = window.document.createRange();
  precedingRange.selectNodeContents(root);
  precedingRange.setEnd(range.startContainer, range.startOffset);

  const followingRange = window.document.createRange();
  followingRange.selectNodeContents(root);
  followingRange.setStart(range.endContainer, range.endOffset);

  return {
    selectedText,
    contextBefore: precedingRange.toString().slice(-CONTEXT_LENGTH),
    contextAfter: followingRange.toString().slice(0, CONTEXT_LENGTH),
  };
}

