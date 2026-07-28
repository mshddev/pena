export function downloadMarkdown(content: string, documentSlug: string): void {
  const blob = new Blob([content], {
    type: "text/markdown;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  const downloadLink = window.document.createElement("a");

  downloadLink.href = objectUrl;
  downloadLink.download = `${documentSlug}.md`;
  downloadLink.hidden = true;
  window.document.body.append(downloadLink);

  try {
    downloadLink.click();
  } finally {
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
