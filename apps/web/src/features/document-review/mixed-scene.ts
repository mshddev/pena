import {
  isSavedSceneElement,
  type ExcalidrawScene,
  type ExcalidrawSceneElement,
} from "@pena/contracts";

const FRAME_TYPES = new Set(["frame", "magicframe"]);

/**
 * What a saved drawing revised by hand hands to Excalidraw's expansion.
 * Expansion reads every frame's `children`, which a saved frame does not
 * have: its members name it in their own `frameId` instead. The saved frame
 * is swapped back for its original afterwards, so an empty list will do.
 */
export function readExpansionInput(
  scene: ExcalidrawScene,
): ExcalidrawSceneElement[] {
  return scene.elements.map((element) =>
    FRAME_TYPES.has(element.type) &&
    isSavedSceneElement(element) &&
    !Array.isArray(element.children)
      ? { ...element, children: [] }
      : element,
  );
}

type Binding = { readonly elementId: string };

interface BindableElement {
  readonly id: string;
  readonly startBinding?: Binding | null;
  readonly endBinding?: Binding | null;
}

const BINDING_FIELDS = ["startBinding", "endBinding"] as const;

/**
 * Restoring the saved elements on their own drops an arrow's binding to any
 * shape that is now a skeleton, as when the author replaced a saved shape
 * under the same id. Such a binding is put back while its shape still exists.
 */
export function keepSavedBindings<Element extends BindableElement>(
  restored: readonly Element[],
  scene: ExcalidrawScene,
): Element[] {
  const sceneIds = new Set(scene.elements.map((element) => element.id));
  const originals = new Map(
    scene.elements
      .filter(isSavedSceneElement)
      .map((element) => [element.id, element]),
  );

  return restored.map((element) => {
    const original = originals.get(element.id);
    let kept = element;

    for (const field of BINDING_FIELDS) {
      const binding = original?.[field];

      if (
        !element[field] &&
        isBinding(binding) &&
        sceneIds.has(binding.elementId)
      ) {
        kept = { ...kept, [field]: binding };
      }
    }

    return kept;
  });
}

interface LinkedElement extends BindableElement {
  readonly boundElements?: readonly { readonly id: string; readonly type: string }[] | null;
}

/**
 * An arrow bound to a shape is listed among that shape's `boundElements`,
 * which is how Excalidraw moves the arrow with the shape once the file is
 * opened there. A saved arrow bound to a shape that is now a skeleton is
 * missing from that list, so it is added.
 */
export function listBoundArrows<Element extends LinkedElement>(
  elements: readonly Element[],
): Element[] {
  const arrowsByShape = new Map<string, string[]>();

  for (const element of elements) {
    for (const field of BINDING_FIELDS) {
      const shapeId = element[field]?.elementId;

      if (shapeId) {
        arrowsByShape.set(shapeId, [...(arrowsByShape.get(shapeId) ?? []), element.id]);
      }
    }
  }

  return elements.map((element) => {
    const listed = element.boundElements ?? [];
    const missing = (arrowsByShape.get(element.id) ?? []).filter(
      (arrowId, index, arrowIds) =>
        arrowIds.indexOf(arrowId) === index &&
        !listed.some((bound) => bound.id === arrowId),
    );

    return missing.length === 0
      ? element
      : {
          ...element,
          boundElements: [
            ...listed,
            ...missing.map((id) => ({ id, type: "arrow" })),
          ],
        };
  });
}

function isBinding(value: unknown): value is Binding {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { elementId?: unknown }).elementId === "string"
  );
}
