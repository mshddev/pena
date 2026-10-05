import {
  parseExcalidrawScene,
  type ExcalidrawSceneElement,
} from "@pena/contracts";

import {
  canvasKindName,
  describeCanvasElements,
  readBoundId,
  readCanvasElementText,
  type CanvasElement,
} from "./canvas-scene";
import { diffMarkdown, type DiffLine } from "./version-diff";

const GEOMETRY_FIELDS = ["x", "y", "width", "height", "angle", "points"];
const STYLE_FIELDS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
  "fontSize",
  "fontFamily",
  "textAlign",
];

/**
 * What changed between two scenes, element by element: added and removed
 * elements by name, a renamed one as both, and one that only moved or changed
 * style as a neutral line. A line diff of scene JSON would be mostly noise.
 * Content that is not a scene falls back to the line diff.
 */
export function diffCanvas(before: string, after: string): DiffLine[] {
  let beforeElements: CanvasElement[];
  let afterElements: CanvasElement[];

  try {
    beforeElements = readElements(before);
    afterElements = readElements(after);
  } catch {
    return diffMarkdown(before, after);
  }

  const beforeById = new Map(beforeElements.map((element) => [element.id, element]));
  const afterIds = new Set(afterElements.map((element) => element.id));
  const lines: DiffLine[] = [];

  for (const element of beforeElements) {
    if (!afterIds.has(element.id) && !isLabel(element)) {
      lines.push({ kind: "removed", text: describe(beforeElements, element) });
    }
  }

  for (const element of readingOrder(afterElements)) {
    if (isLabel(element)) {
      continue;
    }

    const previous = beforeById.get(element.id);
    const name = describe(afterElements, element);

    if (!previous) {
      lines.push({ kind: "added", text: name });
      continue;
    }

    const previousName = describe(beforeElements, previous);

    if (previousName !== name) {
      lines.push(
        { kind: "removed", text: previousName },
        { kind: "added", text: name },
      );
      continue;
    }

    const changes = [
      changed(previous, element, ["type"]) ? "changed kind" : null,
      changed(previous, element, GEOMETRY_FIELDS) ? "moved or resized" : null,
      changed(previous, element, STYLE_FIELDS) ? "restyled" : null,
      readBoundId(previous, "start") !== readBoundId(element, "start") ||
      readBoundId(previous, "end") !== readBoundId(element, "end")
        ? "reconnected"
        : null,
    ].filter((change) => change !== null);

    if (changes.length > 0) {
      lines.push({ kind: "context", text: `${name} — ${changes.join(", ")}` });
    }
  }

  return lines.length > 0
    ? lines
    : [{ kind: "context", text: "No element changed." }];
}

function readElements(content: string): CanvasElement[] {
  return parseExcalidrawScene(content)
    .elements.filter((element) => element.isDeleted !== true)
    .map(toCanvasElement);
}

/** A label changes with its shape, so it is reported through the shape. */
function isLabel(element: CanvasElement): boolean {
  return element.type === "text" && Boolean(element.containerId);
}

/** The kind stays in front, so the box “API” and the note “API” differ. */
function describe(elements: CanvasElement[], element: CanvasElement): string {
  const text = readCanvasElementText(elements, element);

  return text
    ? `${canvasKindName(element)} “${text}”`
    : describeCanvasElements(elements, [element]);
}

function changed(
  before: CanvasElement,
  after: CanvasElement,
  fields: readonly string[],
): boolean {
  const beforeFields = before as unknown as Record<string, unknown>;
  const afterFields = after as unknown as Record<string, unknown>;

  return fields.some(
    (field) =>
      JSON.stringify(beforeFields[field]) !== JSON.stringify(afterFields[field]),
  );
}

function readingOrder(elements: CanvasElement[]): CanvasElement[] {
  return [...elements].sort(
    (first, second) => first.y - second.y || first.x - second.x,
  );
}

/** A stored element as Pena reads it, with zero for any missing number. */
function toCanvasElement(element: ExcalidrawSceneElement): CanvasElement {
  return {
    ...element,
    x: readNumber(element.x),
    y: readNumber(element.y),
    width: readNumber(element.width),
    height: readNumber(element.height),
  } as CanvasElement;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
