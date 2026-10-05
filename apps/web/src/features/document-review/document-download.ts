import {
  isSavedSceneElement,
  parseExcalidrawScene,
  type DocumentFormat,
} from "@pena/contracts";

const DOWNLOADS: Record<DocumentFormat, { mediaType: string; extension: string }> = {
  markdown: { mediaType: "text/markdown", extension: "md" },
  html: { mediaType: "text/html", extension: "html" },
  // The file Excalidraw itself saves and opens.
  excalidraw: { mediaType: "application/vnd.excalidraw+json", extension: "excalidraw" },
};

export async function downloadDocument(
  content: string,
  format: DocumentFormat,
  documentSlug: string,
): Promise<void> {
  // A document from a server older than formats has none, and is Markdown.
  const { mediaType, extension } = DOWNLOADS[format] ?? DOWNLOADS.markdown;
  const body =
    format === "excalidraw" ? await readExcalidrawFile(content) : content;
  const blob = new Blob([body], {
    type: `${mediaType};charset=utf-8`,
  });
  const objectUrl = URL.createObjectURL(blob);
  const downloadLink = window.document.createElement("a");

  downloadLink.href = objectUrl;
  downloadLink.download = `${documentSlug}.${extension}`;
  downloadLink.hidden = true;
  window.document.body.append(downloadLink);

  try {
    downloadLink.click();
  } finally {
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Excalidraw opens only the elements it saves itself, so a scene written as
 * skeletons downloads expanded. A saved scene downloads exactly as stored.
 */
async function readExcalidrawFile(content: string): Promise<string> {
  try {
    const scene = parseExcalidrawScene(content);

    if (scene.elements.every(isSavedSceneElement)) {
      return content;
    }

    const { serializeScene } = await import("./excalidraw-elements");
    return serializeScene(scene);
  } catch {
    return content;
  }
}
