const DECISION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DECISION_ID_MAX_LENGTH = 64;
const CHOICE_MAX_LENGTH = 80;
const BODY_MAX_LENGTH = 10_000;

export interface DecisionBlock {
  id: string;
  choiceA: string;
  choiceB: string;
  body: string;
}

export type DecisionDocumentSegment =
  | { type: "markdown"; content: string }
  | { type: "decision"; decision: DecisionBlock };

export interface ParsedDecisionDocument {
  segments: DecisionDocumentSegment[];
  decisions: DecisionBlock[];
}

interface SourceLine {
  text: string;
  start: number;
  end: number;
}

export class DecisionBlockSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionBlockSyntaxError";
  }
}

export function parseDecisionDocument(
  content: string,
): ParsedDecisionDocument {
  const lines = readLines(content);
  const decisions: DecisionBlock[] = [];
  const segments: DecisionDocumentSegment[] = [];
  const decisionIds = new Set<string>();
  let markdownStart = 0;
  let activeFence: string | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (!line) {
      continue;
    }

    const fence = readFence(line.text);

    if (activeFence) {
      if (isClosingFence(line.text, activeFence)) {
        activeFence = null;
      }
      continue;
    }

    if (fence) {
      activeFence = fence.marker;
      continue;
    }

    if (isNestedDecisionOpener(line.text)) {
      throw syntaxError(lineIndex, "Decision blocks must be top-level.");
    }

    if (!line.text.startsWith(":::pena-decision")) {
      continue;
    }

    const attributes = parseOpener(line.text, lineIndex);
    const closingLineIndex = findClosingLine(lines, lineIndex + 1);

    if (closingLineIndex === null) {
      throw syntaxError(lineIndex, "Decision block is missing its closing :::.");
    }

    if (decisionIds.has(attributes.id)) {
      throw syntaxError(
        lineIndex,
        `Decision ID "${attributes.id}" is duplicated.`,
      );
    }

    const closingLine = lines[closingLineIndex];

    if (!closingLine) {
      throw syntaxError(lineIndex, "Decision block is missing its closing :::.");
    }

    const body = content
      .slice(line.end, closingLine.start)
      .replace(/\r?\n$/, "");

    validateBody(body, lineIndex);

    if (line.start > markdownStart) {
      segments.push({
        type: "markdown",
        content: content.slice(markdownStart, line.start),
      });
    }

    const decision: DecisionBlock = { ...attributes, body };
    decisions.push(decision);
    decisionIds.add(decision.id);
    segments.push({ type: "decision", decision });
    markdownStart = closingLine.end;
    lineIndex = closingLineIndex;
  }

  if (markdownStart < content.length || segments.length === 0) {
    segments.push({
      type: "markdown",
      content: content.slice(markdownStart),
    });
  }

  return { segments, decisions };
}

function parseOpener(
  line: string,
  lineIndex: number,
): Pick<DecisionBlock, "id" | "choiceA" | "choiceB"> {
  const match =
    /^:::pena-decision\{#([a-z0-9]+(?:-[a-z0-9]+)*) choice-a="([^"\r\n]*)" choice-b="([^"\r\n]*)"\}\s*$/.exec(
      line,
    );

  if (!match) {
    throw syntaxError(
      lineIndex,
      'Use :::pena-decision{#decision-id choice-a="First" choice-b="Second"}.',
    );
  }

  const [, id = "", rawChoiceA = "", rawChoiceB = ""] = match;
  const choiceA = rawChoiceA.trim();
  const choiceB = rawChoiceB.trim();

  if (!DECISION_ID_PATTERN.test(id) || id.length > DECISION_ID_MAX_LENGTH) {
    throw syntaxError(
      lineIndex,
      "Decision IDs must use at most 64 lowercase letters, numbers, and single hyphens.",
    );
  }

  if (!choiceA || !choiceB) {
    throw syntaxError(lineIndex, "Decision choices must not be blank.");
  }

  if (
    choiceA.length > CHOICE_MAX_LENGTH ||
    choiceB.length > CHOICE_MAX_LENGTH
  ) {
    throw syntaxError(
      lineIndex,
      `Decision choices must be ${CHOICE_MAX_LENGTH} characters or fewer.`,
    );
  }

  if (choiceA === choiceB) {
    throw syntaxError(lineIndex, "Decision choices must be distinct.");
  }

  return { id, choiceA, choiceB };
}

function findClosingLine(
  lines: SourceLine[],
  startIndex: number,
): number | null {
  let activeFence: string | null = null;

  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (!line) {
      continue;
    }

    const fence = readFence(line.text);

    if (activeFence) {
      if (isClosingFence(line.text, activeFence)) {
        activeFence = null;
      }
      continue;
    }

    if (fence) {
      activeFence = fence.marker;
      continue;
    }

    if (line.text.startsWith(":::pena-decision")) {
      throw syntaxError(lineIndex, "Decision blocks cannot be nested.");
    }

    if (isNestedDecisionOpener(line.text)) {
      throw syntaxError(lineIndex, "Decision blocks cannot be nested.");
    }

    if (/^:::\s*$/.test(line.text)) {
      return lineIndex;
    }
  }

  return null;
}

function validateBody(body: string, lineIndex: number): void {
  if (!body.trim()) {
    throw syntaxError(lineIndex, "Decision body must not be blank.");
  }

  if (body.length > BODY_MAX_LENGTH) {
    throw syntaxError(
      lineIndex,
      `Decision body must be ${BODY_MAX_LENGTH} characters or fewer.`,
    );
  }
}

function isNestedDecisionOpener(line: string): boolean {
  return /^(?:\s+|>\s*|[-+*]\s+):::pena-decision/.test(line);
}

function readFence(
  line: string,
): { marker: string; character: string; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);

  if (!match?.[1]) {
    return null;
  }

  return {
    marker: match[1],
    character: match[1][0] ?? "",
    length: match[1].length,
  };
}

function isClosingFence(line: string, activeFence: string): boolean {
  const character = activeFence[0];

  if (!character) {
    return false;
  }

  const escapedCharacter = character === "`" ? "`" : "~";
  return new RegExp(
    `^ {0,3}${escapedCharacter}{${activeFence.length},}\\s*$`,
  ).test(line);
}

function readLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /.*(?:\r\n|\n|$)/g;

  for (const match of content.matchAll(pattern)) {
    if (match[0] === "") {
      continue;
    }

    const start = match.index;
    const end = start + match[0].length;
    lines.push({
      text: match[0].replace(/\r?\n$/, ""),
      start,
      end,
    });
  }

  return lines;
}

function syntaxError(lineIndex: number, message: string): DecisionBlockSyntaxError {
  return new DecisionBlockSyntaxError(
    `Invalid decision block on line ${lineIndex + 1}: ${message}`,
  );
}
