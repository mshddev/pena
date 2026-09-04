import { UtilityBar } from "./components/UtilityBar";
import { ArchivePage } from "./features/archive/ArchivePage";
import { CollectionsPage } from "./features/collections/CollectionsPage";
import { DocumentReviewPage } from "./features/document-review/DocumentReviewPage";
import { readAppRoute } from "./features/document-review/routing";
import { HomePage } from "./features/home/HomePage";

export function App() {
  const route = readAppRoute(window.location.pathname, window.location.search);

  if (route.kind === "home") {
    return <HomePage collectionSlug={route.collectionSlug} />;
  }

  if (route.kind === "collections") {
    return <CollectionsPage />;
  }

  if (route.kind === "archive") {
    return <ArchivePage collectionSlug={route.collectionSlug} />;
  }

  if (route.kind === "document") {
    return <DocumentReviewPage documentSlug={route.documentSlug} />;
  }

  return (
    <div className="app-shell">
      <UtilityBar current={null} />
      <main className="route-not-found">
        <span aria-hidden="true">404</span>
        <h1>Page not found</h1>
        <a href="/">Return to the dashboard</a>
      </main>
    </div>
  );
}
