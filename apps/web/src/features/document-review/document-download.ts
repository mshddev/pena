import type { DocumentFormat } from "@pena/contracts";

const MARKDOWN_DOWNLOAD = { mediaType: "text/markdown", extension: "md" };
const HTML_DOWNLOAD = { mediaType: "text/html", extension: "html" };

export function downloadDocument(
  content: string,
  format: DocumentFormat,
  documentSlug: string,
): void {
  // A document from a server older than formats has none, and is Markdown.
  const { mediaType, extension } =
    format === "html" ? HTML_DOWNLOAD : MARKDOWN_DOWNLOAD;
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
