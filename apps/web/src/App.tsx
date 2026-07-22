import { ArchivePage } from "./features/archive/ArchivePage";
import { DocumentReviewPage } from "./features/document-review/DocumentReviewPage";
import { readDocumentSlug } from "./features/document-review/routing";

export function App() {
  if (/^\/archive\/?$/.test(window.location.pathname)) {
    return <ArchivePage />;
  }

  const documentSlug = readDocumentSlug(window.location.pathname);

  return <DocumentReviewPage documentSlug={documentSlug} />;
}
