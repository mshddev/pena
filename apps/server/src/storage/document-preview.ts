/** Derives opening prose for document listings without returning the body. */

/** Roughly a short paragraph — enough to preview, far short of the document. */
const EXCERPT_LIMIT = 320;
const TITLE_LIMIT = 200;

export interface ExtractedDocumentTitle {
  title: string | null;
  content: string;
}

/**
 * Moves a legacy leading Markdown H1 into explicit metadata while preserving
 * front matter and every later body block. An H1 elsewhere is a real section,
 * not legacy title material.
 */
export function extractLeadingDocumentTitle(
  content: string,
): ExtractedDocumentTitle {
  const bomLength = content.startsWith("\uFEFF") ? 1 : 0;
  let prefixEnd = bomLength;
  let hasFrontMatter = false;
  const firstLine = readLine(content, bomLength);

  if (firstLine.text.trim() === "---") {
    let cursor = firstLine.next;

    while (cursor < content.length) {
      const line = readLine(content, cursor);

      if (line.text.trim() === "---") {
        prefixEnd = line.next;
        hasFrontMatter = true;
        break;
      }

      cursor = line.next;
    }
  }

  const headingStart = skipBlankLines(content, prefixEnd);
  const headingLine = readLine(content, headingStart);
  const atxHeading = /^ {0,3}#[\t ]+(.*)$/.exec(headingLine.text);
  let rawTitle: string | null = null;
  let headingEnd = headingLine.next;

  if (atxHeading) {
    rawTitle = (atxHeading[1] ?? "").replace(/[\t ]+#+[\t ]*$/, "");
  } else if (headingLine.text.trim().length > 0) {
    const underline = readLine(content, headingLine.next);

    if (/^ {0,3}=+[\t ]*$/.test(underline.text)) {
      rawTitle = headingLine.text;
      headingEnd = underline.next;
    }
  }

  if (rawTitle === null) {
    return { title: null, content };
  }

  const title = stripInline(rawTitle).trim().slice(0, TITLE_LIMIT).trimEnd();

  if (!title) {
    return { title: null, content };
  }

  const bodyStart = skipBlankLines(content, headingEnd);
  const body = content.slice(bodyStart);
  const prefix = content.slice(0, prefixEnd);
  const lineEnding = readLineEnding(content) ?? "\n";
  const separator = hasFrontMatter && body.length > 0 ? lineEnding : "";

  return {
    title,
    content: `${prefix}${separator}${body}`,
  };
}

export function readDocumentExcerpt(content: string): string {
  const paragraphs: string[] = [];

  for (const line of readableLines(content)) {
    if (isHeading(line) || isFurniture(line)) {
      continue;
    }

    const text = stripInline(stripLeadingMarker(line)).trim();

    if (text.length === 0) {
      continue;
    }

    paragraphs.push(text);

    if (paragraphs.join(" ").length >= EXCERPT_LIMIT) {
      break;
    }
  }

  return capAtWord(paragraphs.join(" "));
}

/**
 * Every line that could carry prose: front matter and fenced code are metadata
 * and source, not something a reader would recognise as the document's opening.
 */
function* readableLines(content: string): Generator<string> {
  const lines = content.split("\n");
  let index = 0;
  let fence: string | null = null;

  if (lines[0]?.trim() === "---") {
    index = 1;

    while (index < lines.length && lines[index]?.trim() !== "---") {
      index += 1;
    }

    index += 1;
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMark = /^\s*(```+|~~~+)/.exec(line);

    if (fence !== null) {
      if (fenceMark && line.trim().startsWith(fence)) {
        fence = null;
      }

      continue;
    }

    if (fenceMark) {
      fence = fenceMark[1] ?? null;
      continue;
    }

    yield line;
  }
}

function isHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s/.test(line);
}

/** Structure rather than prose: tables, rules, directives and raw HTML. */
function isFurniture(line: string): boolean {
  return (
    /^\s*\|/.test(line) ||
    /^\s*:::/.test(line) ||
    /^\s*</.test(line) ||
    /^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)
  );
}

function stripLeadingMarker(line: string): string {
  return line
    .replace(/^\s*>+\s?/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
}

function stripInline(text: string): string {
  return (
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/~~([^~]*)~~/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      // Underscores only italicise between word boundaries, which keeps
      // identifiers like comments_json intact.
      .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
      .replace(/\s+/g, " ")
  );
}

/**
 * Cuts on a word boundary and adds no ellipsis — the listing clamps the line
 * and draws its own, and two ellipses in a row read as a mistake.
 */
function capAtWord(text: string): string {
  if (text.length <= EXCERPT_LIMIT) {
    return text;
  }

  const cut = text.slice(0, EXCERPT_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");

  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

interface ContentLine {
  text: string;
  next: number;
}

function readLine(content: string, start: number): ContentLine {
  const lineFeed = content.indexOf("\n", start);

  if (lineFeed === -1) {
    return {
      text: content.slice(start).replace(/\r$/, ""),
      next: content.length,
    };
  }

  const lineEnd =
    lineFeed > start && content[lineFeed - 1] === "\r"
      ? lineFeed - 1
      : lineFeed;

  return {
    text: content.slice(start, lineEnd),
    next: lineFeed + 1,
  };
}

function skipBlankLines(content: string, start: number): number {
  let cursor = start;

  while (cursor < content.length) {
    const line = readLine(content, cursor);

    if (line.text.trim().length > 0) {
      break;
    }

    cursor = line.next;
  }

  return cursor;
}

function readLineEnding(content: string): "\r\n" | "\n" | null {
  const lineFeed = content.indexOf("\n");

  if (lineFeed === -1) {
    return null;
  }

  return lineFeed > 0 && content[lineFeed - 1] === "\r" ? "\r\n" : "\n";
}
