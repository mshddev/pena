const ELEMENT_ID_MAX_LENGTH = 100;
const FRAME_TYPES = new Set(["frame", "magicframe"]);

/**
 * One element of an Excalidraw scene. Pena reads only the fields it needs and
 * leaves the rest to Excalidraw, which fills in whatever an element omits.
 */
export interface ExcalidrawSceneElement {
  id: string;
  type: string;
  [field: string]: unknown;
}

/** The JSON of an `.excalidraw` file, as Excalidraw saves and loads it. */
export interface ExcalidrawScene {
  type: "excalidraw";
  elements: ExcalidrawSceneElement[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  [field: string]: unknown;
}

export class ExcalidrawSceneSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcalidrawSceneSyntaxError";
  }
}

/**
 * Checks the scene's outer shape and that every element has a unique `id`,
 * since that id is what a reviewer's comment points at.
 */
export function parseExcalidrawScene(content: string): ExcalidrawScene {
  let scene: unknown;

  try {
    scene = JSON.parse(content);
  } catch (error) {
    throw new ExcalidrawSceneSyntaxError(
      `Excalidraw content must be JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(scene) || scene.type !== "excalidraw") {
    throw new ExcalidrawSceneSyntaxError(
      'Excalidraw content must be a scene object with "type": "excalidraw".',
    );
  }

  if (!Array.isArray(scene.elements)) {
    throw new ExcalidrawSceneSyntaxError(
      'The scene must have an "elements" array.',
    );
  }

  for (const field of ["appState", "files"] as const) {
    if (scene[field] !== undefined && !isRecord(scene[field])) {
      throw new ExcalidrawSceneSyntaxError(
        `The scene's "${field}" must be an object.`,
      );
    }
  }

  const elementIds = new Set<string>();

  scene.elements.forEach((element: unknown, index) => {
    if (!isRecord(element)) {
      throw elementError(index, "is not an object");
    }

    if (typeof element.type !== "string" || element.type.trim() === "") {
      throw elementError(index, 'needs a "type"');
    }

    if (
      typeof element.id !== "string" ||
      element.id.trim() === "" ||
      element.id.length > ELEMENT_ID_MAX_LENGTH
    ) {
      throw elementError(
        index,
        `needs an "id" of 1 to ${ELEMENT_ID_MAX_LENGTH} characters`,
      );
    }

    if (elementIds.has(element.id)) {
      throw elementError(index, `repeats the id "${element.id}"`);
    }

    elementIds.add(element.id);
  });

  scene.elements.forEach((element: Record<string, unknown>, index) => {
    if (!isSavedSceneElement(element)) {
      checkSkeletonReferences(element, index, elementIds);
    }
  });

  return scene as ExcalidrawScene;
}

/**
 * Excalidraw writes a seed and a version on every element it saves. Any
 * other element is a skeleton, which Excalidraw expands when it loads.
 */
export function isSavedSceneElement(element: Record<string, unknown>): boolean {
  return typeof element.seed === "number" && typeof element.version === "number";
}

/**
 * Expanding a skeleton fails on a frame without `children` or on an id that
 * names no element, so those are caught when the scene is published.
 */
function checkSkeletonReferences(
  element: Record<string, unknown>,
  index: number,
  elementIds: ReadonlySet<string>,
): void {
  if (FRAME_TYPES.has(element.type as string)) {
    if (
      !Array.isArray(element.children) ||
      !element.children.every((child) => typeof child === "string")
    ) {
      throw elementError(index, 'is a frame and needs a "children" array of element ids');
    }

    for (const child of element.children as string[]) {
      if (!elementIds.has(child)) {
        throw elementError(index, `lists "${child}" in "children", but no element has that id`);
      }
    }
  }

  for (const end of ["start", "end"] as const) {
    const bound = element[end];

    if (isRecord(bound) && typeof bound.id === "string" && !elementIds.has(bound.id)) {
      throw elementError(index, `binds its ${end} to "${bound.id}", but no element has that id`);
    }
  }
}

/**
 * The scene's visible text in reading order, top to bottom and then left to
 * right: text elements, and the labels of shapes written as skeletons.
 */
export function readExcalidrawSceneText(scene: ExcalidrawScene): string[] {
  const texts: Array<{ text: string; x: number; y: number }> = [];

  for (const element of scene.elements) {
    if (element.isDeleted === true) {
      continue;
    }

    const text =
      element.type === "text"
        ? readString(element.originalText) ?? readString(element.text)
        : isRecord(element.label)
          ? readString(element.label.text)
          : null;

    if (text) {
      texts.push({
        text: text.replace(/\s+/g, " ").trim(),
        x: readNumber(element.x),
        y: readNumber(element.y),
      });
    }
  }

  return texts
    .filter(({ text }) => text.length > 0)
    .sort((first, second) => first.y - second.y || first.x - second.x)
    .map(({ text }) => text);
}

function elementError(index: number, problem: string): ExcalidrawSceneSyntaxError {
  return new ExcalidrawSceneSyntaxError(`Scene element ${index} ${problem}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
