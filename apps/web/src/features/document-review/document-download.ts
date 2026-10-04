import type { DocumentFormat } from "@pena/contracts";

const DOWNLOADS: Record<DocumentFormat, { mediaType: string; extension: string }> = {
  markdown: { mediaType: "text/markdown", extension: "md" },
  html: { mediaType: "text/html", extension: "html" },
  // The file Excalidraw itself saves and opens.
  excalidraw: { mediaType: "application/vnd.excalidraw+json", extension: "excalidraw" },
};

export function downloadDocument(
  content: string,
  format: DocumentFormat,
  documentSlug: string,
): void {
  // A document from a server older than formats has none, and is Markdown.
  const { mediaType, extension } = DOWNLOADS[format] ?? DOWNLOADS.markdown;
  const blob = new Blob([content], {
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
