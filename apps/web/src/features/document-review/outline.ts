/**
 * One heading in the rendered document. The outline is read back off the DOM
 * rather than re-parsed from the Markdown, so it always matches what is on the
 * page — including the headings that live inside decision blocks.
 */
export interface OutlineSection {
  id: string;
  text: string;
  /** A decision's own heading sits under the section that introduces it. */
  nested: boolean;
}

/** Ties an outline entry to the heading element it scrolls to. */
export const OUTLINE_SECTION_ATTRIBUTE = "data-outline-section";

export function readOutlineSections(surface: HTMLElement): OutlineSection[] {
  return [...surface.querySelectorAll<HTMLElement>("h1, h2")].map(
    (heading, index) => {
      const id = `pena-section-${index}`;

      heading.id = id;
      heading.setAttribute(OUTLINE_SECTION_ATTRIBUTE, id);

      return {
        id,
        text: heading.textContent ?? "",
        nested: heading.closest(".decision-block") !== null,
      };
    },
  );
}

/**
 * The last heading that has passed under the sticky utility bar. Anything above
 * that line has been read, so the deepest one wins.
 */
export function readActiveSection(surface: HTMLElement): string | null {
  const headings = [
    ...surface.querySelectorAll<HTMLElement>(`[${OUTLINE_SECTION_ATTRIBUTE}]`),
  ];
  const readLine =
    (window.document
      .querySelector<HTMLElement>(".utility-bar")
      ?.getBoundingClientRect().bottom ?? 0) + 24;
  let active = headings[0]?.getAttribute(OUTLINE_SECTION_ATTRIBUTE) ?? null;

  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > readLine) {
      break;
    }

    active = heading.getAttribute(OUTLINE_SECTION_ATTRIBUTE) ?? active;
  }

  return active;
}
