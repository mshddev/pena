/**
 * A small line-based scanner for Markdown image references
 * (`![alt](destination "title")`). It skips fenced code blocks, inline code
 * spans, and backslash-escaped bangs. Reference-style images and `<img>` tags
 * are not recognised.
 */

export interface MarkdownImageReference {
  /** 1-based line number. */
  line: number;
  /** Offset of the destination's first character within the whole document. */
  start: number;
  /** Offset just past the destination's last character. */
  end: number;
  destination: string;
}

// Lines come from a split on "\n", so a CRLF file leaves a trailing "\r" here.
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*?)\r?$/;

export function findMarkdownImages(markdown: string): MarkdownImageReference[] {
  const references: MarkdownImageReference[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let fence: { marker: string; length: number } | null = null;

  for (const [index, line] of lines.entries()) {
    const match = FENCE_PATTERN.exec(line);

    if (fence) {
      if (
        match &&
        match[1]?.[0] === fence.marker &&
        (match[1]?.length ?? 0) >= fence.length &&
        (match[2] ?? "").trim() === ""
      ) {
        fence = null;
      }
    } else if (match && (match[1]?.[0] === "~" || !match[2]?.includes("`"))) {
      fence = { marker: match[1]?.[0] ?? "`", length: match[1]?.length ?? 3 };
    } else {
      for (const image of scanLine(line)) {
        references.push({
          line: index + 1,
          start: offset + image.start,
          end: offset + image.end,
          destination: image.destination,
        });
      }
    }

    offset += line.length + 1;
  }

  return references;
}

interface LineImage {
  start: number;
  end: number;
  destination: string;
}

function scanLine(line: string): LineImage[] {
  const images: LineImage[] = [];
  let index = 0;

  while (index < line.length) {
    const character = line[index];

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === "`") {
      index = skipCodeSpan(line, index);
      continue;
    }

    if (character === "!" && line[index + 1] === "[") {
      const image = parseImage(line, index);

      if (image) {
        images.push(image.reference);
        index = image.next;
        continue;
      }
    }

    index += 1;
  }

  return images;
}

/** Returns the index after a code span opened at `start`, or after the opening run when it never closes. */
function skipCodeSpan(line: string, start: number): number {
  const length = runLength(line, start);
  let index = start + length;

  while (index < line.length) {
    if (line[index] === "`") {
      const closing = runLength(line, index);

      if (closing === length) {
        return index + closing;
      }

      index += closing;
    } else {
      index += 1;
    }
  }

  return start + length;
}

function runLength(line: string, start: number): number {
  let length = 0;

  while (line[start + length] === "`") {
    length += 1;
  }

  return length;
}

function parseImage(
  line: string,
  start: number,
): { reference: LineImage; next: number } | null {
  let index = start + 2;
  let depth = 0;

  while (index < line.length) {
    const character = line[index];

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === "`") {
      index = skipCodeSpan(line, index);
      continue;
    }

    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      if (depth === 0) {
        break;
      }

      depth -= 1;
    }

    index += 1;
  }

  if (line[index] !== "]" || line[index + 1] !== "(") {
    return null;
  }

  index += 2;

  while (line[index] === " " || line[index] === "\t") {
    index += 1;
  }

  let destinationStart: number;
  let destinationEnd: number;

  if (line[index] === "<") {
    destinationStart = index + 1;
    const close = line.indexOf(">", destinationStart);

    if (close === -1) {
      return null;
    }

    destinationEnd = close;
    index = close + 1;
  } else {
    destinationStart = index;
    let parenthesisDepth = 0;

    while (index < line.length) {
      const character = line[index];

      if (character === "\\") {
        index += 2;
        continue;
      }

      if (character === " " || character === "\t") {
        break;
      }

      if (character === "(") {
        parenthesisDepth += 1;
      } else if (character === ")") {
        if (parenthesisDepth === 0) {
          break;
        }

        parenthesisDepth -= 1;
      }

      index += 1;
    }

    destinationEnd = Math.min(index, line.length);
  }

  while (line[index] === " " || line[index] === "\t") {
    index += 1;
  }

  if (line[index] === '"' || line[index] === "'" || line[index] === "(") {
    const closer = line[index] === "(" ? ")" : line[index];
    index += 1;

    while (index < line.length && line[index] !== closer) {
      index += line[index] === "\\" ? 2 : 1;
    }

    if (index >= line.length) {
      return null;
    }

    index += 1;

    while (line[index] === " " || line[index] === "\t") {
      index += 1;
    }
  }

  if (line[index] !== ")") {
    return null;
  }

  const destination = line.slice(destinationStart, destinationEnd);

  if (destination.length === 0) {
    return null;
  }

  return {
    reference: { start: destinationStart, end: destinationEnd, destination },
    next: index + 1,
  };
}

/** Whether a destination points at a local file rather than a remote, inline, or already uploaded image. */
export function isLocalImageDestination(destination: string): boolean {
  const trimmed = destination.trim();

  if (trimmed.length === 0) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]+:/i.test(trimmed)) {
    // http://, https://, data:, and any other URL scheme.
    return false;
  }

  if (trimmed.startsWith("//")) {
    return false;
  }

  if (trimmed.startsWith("/api/assets/")) {
    return false;
  }

  return true;
}

/**
 * Returns a copy of the Markdown with every image destination for which
 * `replace` returns a string swapped for that string. The source is not
 * modified.
 */
export function rewriteMarkdownImages(
  markdown: string,
  replace: (destination: string) => string | null,
): string {
  let output = "";
  let cursor = 0;

  for (const reference of findMarkdownImages(markdown)) {
    const replacement = replace(reference.destination);

    if (replacement === null) {
      continue;
    }

    output += markdown.slice(cursor, reference.start) + replacement;
    cursor = reference.end;
  }

  return output + markdown.slice(cursor);
}
