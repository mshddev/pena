import { toViewportRect } from "./frame-geometry";

/**
 * One heading in the rendered document. The outline is read back off the DOM
 * rather than re-parsed from the Markdown, so it always matches what is on the
 * page — including the headings that live inside decision blocks.
 */
export interface OutlineSection {
  id: string;
  text: string;
  /** Zero-based nesting derived from the document's heading hierarchy. */
  depth: number;
}

/** Ties an outline entry to the heading element it scrolls to. */
export const OUTLINE_SECTION_ATTRIBUTE = "data-outline-section";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/**
 * `frameSurface` is an HTML page embedded below the surface; its headings
 * follow the surface's own.
 */
export function readOutlineSections(
  surface: HTMLElement,
  frameSurface?: HTMLElement | null,
): OutlineSection[] {
  const headings = [
    ...surface.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR),
    ...(frameSurface?.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR) ??
      []),
  ];
  const rootLevel = Math.min(
    ...headings.map((heading) => readHeadingLevel(heading)),
  );

  return headings.map(
    (heading, index) => {
      const id = `pena-section-${index}`;
      const hierarchyDepth = readHeadingLevel(heading) - rootLevel;
      // A decision remains subordinate even if its author used a root-level
      // heading inside the block.
      const decisionDepth = heading.closest(".decision-block") ? 1 : 0;

      // An embedded page keeps its own ids, which its links and scripts use.
      if (heading.ownerDocument === surface.ownerDocument) {
        heading.id = id;
      }

      heading.setAttribute(OUTLINE_SECTION_ATTRIBUTE, id);

      return {
        id,
        text: heading.textContent ?? "",
        depth: Math.max(hierarchyDepth, decisionDepth),
      };
    },
  );
}

function readHeadingLevel(heading: HTMLHeadingElement): number {
  return Number(heading.tagName.slice(1));
}

/**
 * The last heading that has passed under the sticky utility bar. Anything above
 * that line has been read, so the deepest one wins.
 */
export function readActiveSection(
  surface: HTMLElement,
  frameSurface?: HTMLElement | null,
): string | null {
  const selector = `[${OUTLINE_SECTION_ATTRIBUTE}]`;
  const headings = [
    ...surface.querySelectorAll<HTMLElement>(selector),
    ...(frameSurface?.querySelectorAll<HTMLElement>(selector) ?? []),
  ];
  const readLine =
    (window.document
      .querySelector<HTMLElement>(".utility-bar")
      ?.getBoundingClientRect().bottom ?? 0) + 24;
  let active = headings[0]?.getAttribute(OUTLINE_SECTION_ATTRIBUTE) ?? null;

  for (const heading of headings) {
    const top = toViewportRect(
      heading.getBoundingClientRect(),
      heading,
      window.document,
    ).top;

    if (top > readLine) {
      break;
    }

    active = heading.getAttribute(OUTLINE_SECTION_ATTRIBUTE) ?? active;
  }

  return active;
}

/** The heading an outline entry points at inside `root`, if it is there. */
export function findOutlineHeading(
  root: HTMLElement,
  sectionId: string,
): HTMLElement | null {
  return (
    Array.from(
      root.querySelectorAll<HTMLElement>(`[${OUTLINE_SECTION_ATTRIBUTE}]`),
    ).find(
      (heading) =>
        heading.getAttribute(OUTLINE_SECTION_ATTRIBUTE) === sectionId,
    ) ?? null
  );
}
