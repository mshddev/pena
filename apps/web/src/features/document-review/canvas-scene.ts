import {
  isFrameElementType,
  type CanvasBounds,
  type CanvasTarget,
} from "@pena/contracts";

/**
 * The fields Pena reads from an Excalidraw element. They are a subset of
 * Excalidraw's own element type, so this module stays out of its bundle.
 */
export interface CanvasElement {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle?: number;
  readonly strokeWidth?: number;
  readonly backgroundColor?: string;
  /** Set on a line or arrow drawn as a curve through its points. */
  readonly roundness?: unknown;
  readonly isDeleted?: boolean;
  readonly points?: readonly (readonly [number, number])[];
  readonly containerId?: string | null;
  readonly text?: string;
  readonly originalText?: string;
  readonly name?: string | null;
  /** A shape's label in a hand-written scene, before Excalidraw binds it. */
  readonly label?: { readonly text?: string } | null;
  readonly startBinding?: { readonly elementId: string } | null;
  readonly endBinding?: { readonly elementId: string } | null;
  /** An arrow's ends in a hand-written scene, before Excalidraw binds them. */
  readonly start?: { readonly id?: string } | null;
  readonly end?: { readonly id?: string } | null;
}

/** Excalidraw's camera: scene point `p` sits at `(p + scroll) * zoom`. */
export interface CanvasViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/** A frame in the scene, listed in the outline. */
export interface CanvasSection {
  elementId: string;
  text: string;
}

/** How near a click must land to a line, in screen pixels. */
const HIT_TOLERANCE = 6;
const SELECTED_TEXT_LIMIT = 10_000;
/** The most element ids one comment may carry (the feedback contract's cap). */
export const MAX_TARGET_ELEMENTS = 50;
/** Past this many, a description names the first few and counts the rest. */
const NAMED_ELEMENTS_LIMIT = 12;
/** Points sampled along each stretch of a curved line. */
const CURVE_SAMPLES = 12;
const FILLABLE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINEAR_TYPES = new Set(["arrow", "line"]);
/** Elements drawn as a stroke through their points. */
const STROKE_TYPES = new Set(["arrow", "line", "freedraw"]);

export function sceneToViewport(
  point: CanvasPoint,
  viewport: CanvasViewport,
): CanvasPoint {
  return {
    x: (point.x + viewport.scrollX) * viewport.zoom,
    y: (point.y + viewport.scrollY) * viewport.zoom,
  };
}

export function viewportToScene(
  point: CanvasPoint,
  viewport: CanvasViewport,
): CanvasPoint {
  return {
    x: point.x / viewport.zoom - viewport.scrollX,
    y: point.y / viewport.zoom - viewport.scrollY,
  };
}

/** A scene rectangle in the canvas's own pixels. */
export function boundsToViewport(
  bounds: CanvasBounds,
  viewport: CanvasViewport,
): CanvasBounds {
  const origin = sceneToViewport(bounds, viewport);

  return {
    x: origin.x,
    y: origin.y,
    width: bounds.width * viewport.zoom,
    height: bounds.height * viewport.zoom,
  };
}

/** The axis-aligned box around an element, rotation included. */
export function readElementBounds(element: CanvasElement): CanvasBounds {
  const box = readUnrotatedBox(element);
  const angle = element.angle ?? 0;

  if (angle === 0) {
    return box;
  }

  const center = boxCenter(box);
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ].map((corner) => rotate(corner, center, angle));

  return boundsOfPoints(corners);
}

export function unionBounds(bounds: readonly CanvasBounds[]): CanvasBounds {
  return boundsOfPoints(
    bounds.flatMap((box) => [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    ]),
  );
}

/** The rectangle between two corners, in either order. */
export function boundsBetween(
  first: CanvasPoint,
  second: CanvasPoint,
): CanvasBounds {
  return boundsOfPoints([first, second]);
}

/**
 * The element a click at `point` (scene coordinates) lands on. A click on
 * something drawn there (a line, text, an outline, a filled shape) takes the
 * topmost such element; a shape's label stands for its shape. Only a click
 * on the empty inside of a frame or a transparent shape falls back to the
 * smallest one around it, so a box drawn around others never hides them.
 */
export function findElementAtPoint(
  elements: readonly CanvasElement[],
  point: CanvasPoint,
  zoom: number,
): CanvasElement | null {
  const tolerance = HIT_TOLERANCE / zoom;
  let enclosing: CanvasElement | null = null;
  let enclosingArea = Infinity;

  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    const hit = element && !element.isDeleted
      ? hitElement(element, point, tolerance)
      : null;

    if (!element || hit === null) {
      continue;
    }

    if (hit === "drawn") {
      return findContainer(elements, element) ?? element;
    }

    const { width, height } = readElementBounds(element);

    if (width * height < enclosingArea) {
      enclosing = element;
      enclosingArea = width * height;
    }
  }

  return enclosing;
}

/**
 * The elements lying wholly inside `bounds`, as a drag selection picks them.
 * Labels come with their shapes rather than on their own.
 */
export function findElementsInBounds(
  elements: readonly CanvasElement[],
  bounds: CanvasBounds,
): CanvasElement[] {
  return elements.filter(
    (element) =>
      !element.isDeleted &&
      !findContainer(elements, element) &&
      containsBounds(bounds, readElementBounds(element)),
  );
}

/** What a comment on `picked` points at, for the feedback the agent reads. */
export function createCanvasTarget(
  picked: readonly CanvasElement[],
  area: CanvasBounds | null,
): CanvasTarget {
  return {
    elementIds: picked
      .slice(0, MAX_TARGET_ELEMENTS)
      .map((element) => element.id),
    bounds: roundBounds(
      area ?? unionBounds(picked.map((element) => readElementBounds(element))),
    ),
  };
}

/**
 * Names the picked elements the way a reader would: by their text, or by
 * their kind when they have none. Stands in for a comment's selected text.
 */
export function describeCanvasElements(
  elements: readonly CanvasElement[],
  picked: readonly CanvasElement[],
): string {
  if (picked.length === 0) {
    return "Empty area";
  }

  const named = picked
    .slice(0, NAMED_ELEMENTS_LIMIT)
    .map((element) => describeElement(elements, element))
    .join(", ");
  const description =
    picked.length > NAMED_ELEMENTS_LIMIT
      ? `${named}, and ${picked.length - NAMED_ELEMENTS_LIMIT} more`
      : named;

  return description.length > SELECTED_TEXT_LIMIT
    ? `${description.slice(0, SELECTED_TEXT_LIMIT - 1)}…`
    : description;
}

/** The scene's frames, top to bottom and then left to right. */
export function readCanvasSections(
  elements: readonly CanvasElement[],
): CanvasSection[] {
  return elements
    .filter((element) => !element.isDeleted && isFrameElementType(element.type))
    .sort((first, second) => first.y - second.y || first.x - second.x)
    .map((frame, index) => ({
      elementId: frame.id,
      text: frame.name?.trim() || `Frame ${index + 1}`,
    }));
}

function describeElement(
  elements: readonly CanvasElement[],
  element: CanvasElement,
): string {
  const text = readCanvasElementText(elements, element);

  if (text) {
    return text;
  }

  if (LINEAR_TYPES.has(element.type)) {
    const start = readBoundName(elements, readBoundId(element, "start"));
    const end = readBoundName(elements, readBoundId(element, "end"));

    if (start && end) {
      return `${canvasKindName(element)} from ${start} to ${end}`;
    }

    if (start || end) {
      return `${canvasKindName(element)} ${start ? `from ${start}` : `to ${end}`}`;
    }
  }

  return canvasKindName(element);
}

/** The id of the shape an arrow's end is bound to, saved or hand-written. */
export function readBoundId(
  element: CanvasElement,
  end: "start" | "end",
): string | null {
  const binding = end === "start" ? element.startBinding : element.endBinding;
  return binding?.elementId ?? element[end]?.id ?? null;
}

function readBoundName(
  elements: readonly CanvasElement[],
  boundId: string | null,
): string | null {
  const bound = boundId
    ? elements.find((element) => element.id === boundId)
    : undefined;
  const text = bound ? readCanvasElementText(elements, bound) : null;

  return text ? quote(text) : bound ? canvasKindName(bound).toLowerCase() : null;
}

/** An element's own text, its label's, or a frame's name. */
export function readCanvasElementText(
  elements: readonly CanvasElement[],
  element: CanvasElement,
): string | null {
  if (element.type === "text") {
    return normalizeText(element.originalText ?? element.text);
  }

  if (isFrameElementType(element.type)) {
    return normalizeText(element.name ?? undefined);
  }

  const label = elements.find(
    (candidate) =>
      !candidate.isDeleted &&
      candidate.type === "text" &&
      candidate.containerId === element.id,
  );

  return label
    ? normalizeText(label.originalText ?? label.text)
    : normalizeText(element.label?.text);
}

function normalizeText(text: string | undefined): string | null {
  const normalized = text?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function quote(text: string): string {
  return `“${text}”`;
}

/** The element's kind as a reader would name it: "Rectangle", "Arrow". */
export function canvasKindName(element: CanvasElement): string {
  const kind = element.type === "magicframe" ? "frame" : element.type;
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function findContainer(
  elements: readonly CanvasElement[],
  element: CanvasElement,
): CanvasElement | null {
  if (element.type !== "text" || !element.containerId) {
    return null;
  }

  return (
    elements.find(
      (candidate) =>
        candidate.id === element.containerId && !candidate.isDeleted,
    ) ?? null
  );
}

/**
 * Whether `point` lands on something drawn for the element, or only inside
 * the empty area of a frame or a transparent shape.
 */
function hitElement(
  element: CanvasElement,
  point: CanvasPoint,
  tolerance: number,
): "drawn" | "enclosed" | null {
  const box = readUnrotatedBox(element);
  // Testing the point turned back by the element's angle is the same as
  // testing it against the turned element.
  const local = rotate(point, boxCenter(box), -(element.angle ?? 0));

  if (STROKE_TYPES.has(element.type) && element.points && element.points.length > 1) {
    const reach = tolerance + (element.strokeWidth ?? 1) / 2;
    const path = readLinePath(element);

    return path.slice(1).some((end, index) => {
      const start = path[index];
      return start !== undefined && distanceToSegment(local, start, end) <= reach;
    })
      ? "drawn"
      : null;
  }

  const distance = distanceFromOutline(element.type, local, box);

  if (distance > tolerance) {
    return null;
  }

  // The outline is drawn; the space inside an empty shape is not.
  const edge = tolerance + (element.strokeWidth ?? 1) / 2;
  const isEmpty =
    isFrameElementType(element.type) ||
    (FILLABLE_TYPES.has(element.type) &&
      (!element.backgroundColor || element.backgroundColor === "transparent"));

  return isEmpty && distance < -edge ? "enclosed" : "drawn";
}

/**
 * How far `point` lies outside the element's outline, negative inside. An
 * ellipse or a diamond is measured against its own shape rather than its
 * box, closely enough for picking.
 */
function distanceFromOutline(
  type: string,
  point: CanvasPoint,
  box: CanvasBounds,
): number {
  const rx = box.width / 2;
  const ry = box.height / 2;
  const dx = point.x - (box.x + rx);
  const dy = point.y - (box.y + ry);

  if (rx > 0 && ry > 0 && type === "ellipse") {
    return (Math.hypot(dx / rx, dy / ry) - 1) * Math.min(rx, ry);
  }

  if (rx > 0 && ry > 0 && type === "diamond") {
    return (
      (Math.abs(dx) / rx + Math.abs(dy) / ry - 1) * ((rx * ry) / Math.hypot(rx, ry))
    );
  }

  const outsideX = Math.abs(dx) - rx;
  const outsideY = Math.abs(dy) - ry;

  return outsideX > 0 || outsideY > 0
    ? Math.hypot(Math.max(outsideX, 0), Math.max(outsideY, 0))
    : Math.max(outsideX, outsideY);
}

/**
 * A line's points in scene coordinates. A curved line passes through them
 * along a smooth curve, approximated here by points sampled along it.
 */
function readLinePath(element: CanvasElement): CanvasPoint[] {
  const points = (element.points ?? []).map(([x, y]) => ({
    x: element.x + x,
    y: element.y + y,
  }));

  if (!element.roundness || points.length < 3) {
    return points;
  }

  const path: CanvasPoint[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;

    if (!p0 || !p1 || !p2 || !p3) {
      continue;
    }

    for (let step = 0; step < CURVE_SAMPLES; step += 1) {
      path.push(catmullRom(p0, p1, p2, p3, step / CURVE_SAMPLES));
    }
  }

  const last = points.at(-1);
  return last ? [...path, last] : path;
}

/** The point at `t` on the curve from `p1` to `p2`, shaped by its neighbours. */
function catmullRom(
  p0: CanvasPoint,
  p1: CanvasPoint,
  p2: CanvasPoint,
  p3: CanvasPoint,
  t: number,
): CanvasPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const along = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (c - a) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (3 * b - a - 3 * c + d) * t3);

  return {
    x: along(p0.x, p1.x, p2.x, p3.x),
    y: along(p0.y, p1.y, p2.y, p3.y),
  };
}

/**
 * The element's box before rotation. A line or a freehand stroke spans its
 * points, which may sit left of or above its origin.
 */
function readUnrotatedBox(element: CanvasElement): CanvasBounds {
  if (element.points && element.points.length > 0) {
    return boundsOfPoints(
      element.points.map(([x, y]) => ({ x: element.x + x, y: element.y + y })),
    );
  }

  return {
    x: element.x,
    y: element.y,
    width: Math.max(0, element.width),
    height: Math.max(0, element.height),
  };
}

function boundsOfPoints(points: readonly CanvasPoint[]): CanvasBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

function containsBounds(outer: CanvasBounds, inner: CanvasBounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function boxCenter(box: CanvasBounds): CanvasPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function rotate(
  point: CanvasPoint,
  center: CanvasPoint,
  angle: number,
): CanvasPoint {
  if (angle === 0) {
    return point;
  }

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function distanceToSegment(
  point: CanvasPoint,
  start: CanvasPoint,
  end: CanvasPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared,
          ),
        );

  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function roundBounds(bounds: CanvasBounds): CanvasBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}
