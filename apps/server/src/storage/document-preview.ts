/**
 * A document's own first heading and the prose that opens it, derived here so a
 * listing can say what a document is about without being sent its whole body.
 */

/** Roughly a short paragraph — enough to preview, far short of the document. */
const EXCERPT_LIMIT = 320;

export function readDocumentHeading(content: string): string | null {
  for (const line of readableLines(content)) {
    const heading = /^\s{0,3}#\s+(.*)$/.exec(line);

    if (!heading) {
      continue;
    }

    // A closed ATX heading repeats the hashes at the end: `# Title #`.
    const text = stripInline(
      (heading[1] ?? "").replace(/\s+#+\s*$/, ""),
    ).trim();

    if (text.length > 0) {
      return text;
    }
  }

  return null;
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
