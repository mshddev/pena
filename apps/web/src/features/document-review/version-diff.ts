export type DiffLineKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

const MAX_LCS_CELLS = 1_000_000;

export function diffMarkdown(before: string, after: string): DiffLine[] {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let prefixLength = 0;

  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;

  while (
    suffixLength < beforeLines.length - prefixLength &&
    suffixLength < afterLines.length - prefixLength &&
    beforeLines[beforeLines.length - suffixLength - 1] ===
      afterLines[afterLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const prefix = beforeLines
    .slice(0, prefixLength)
    .map((text) => ({ kind: "context" as const, text }));
  const beforeMiddle = beforeLines.slice(
    prefixLength,
    beforeLines.length - suffixLength,
  );
  const afterMiddle = afterLines.slice(
    prefixLength,
    afterLines.length - suffixLength,
  );
  const suffix = beforeLines
    .slice(beforeLines.length - suffixLength)
    .map((text) => ({ kind: "context" as const, text }));

  return [...prefix, ...diffMiddle(beforeMiddle, afterMiddle), ...suffix];
}

function diffMiddle(before: string[], after: string[]): DiffLine[] {
  if (before.length * after.length > MAX_LCS_CELLS) {
    return [
      ...before.map((text) => ({ kind: "removed" as const, text })),
      ...after.map((text) => ({ kind: "added" as const, text })),
    ];
  }

  const lengths = Array.from({ length: before.length + 1 }, () =>
    new Uint32Array(after.length + 1),
  );

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex]![afterIndex] =
        before[beforeIndex] === after[afterIndex]
          ? lengths[beforeIndex + 1]![afterIndex + 1]! + 1
          : Math.max(
              lengths[beforeIndex + 1]![afterIndex]!,
              lengths[beforeIndex]![afterIndex + 1]!,
            );
    }
  }

  const lines: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < before.length || afterIndex < after.length) {
    if (
      beforeIndex < before.length &&
      afterIndex < after.length &&
      before[beforeIndex] === after[afterIndex]
    ) {
      lines.push({ kind: "context", text: before[beforeIndex] ?? "" });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      afterIndex < after.length &&
      (beforeIndex === before.length ||
        lengths[beforeIndex]![afterIndex + 1]! >
          lengths[beforeIndex + 1]![afterIndex]!)
    ) {
      lines.push({ kind: "added", text: after[afterIndex] ?? "" });
      afterIndex += 1;
    } else {
      lines.push({ kind: "removed", text: before[beforeIndex] ?? "" });
      beforeIndex += 1;
    }
  }

  return lines;
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}
