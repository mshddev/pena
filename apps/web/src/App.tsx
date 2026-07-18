import { DocumentReviewPage } from "./features/document-review/DocumentReviewPage";
import { readDocumentSlug } from "./features/document-review/routing";

export function App() {
  const documentSlug = readDocumentSlug(window.location.pathname);

  return <DocumentReviewPage documentSlug={documentSlug} />;
}
