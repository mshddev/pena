import { ArchivePage } from "./features/archive/ArchivePage";
import { DocumentReviewPage } from "./features/document-review/DocumentReviewPage";
import { readAppRoute } from "./features/document-review/routing";
import { WorkspacesPage } from "./features/workspaces/WorkspacesPage";

export function App() {
  if (window.location.pathname === "/") {
    window.location.replace("/workspaces/default");
    return null;
  }

  const route = readAppRoute(window.location.pathname, window.location.search);

  if (route.kind === "workspaces") {
    return <WorkspacesPage />;
  }

  if (route.kind === "archive") {
    return <ArchivePage workspaceSlug={route.workspaceSlug} />;
  }

  if (route.kind === "documents") {
    return (
      <DocumentReviewPage
        workspaceSlug={route.workspaceSlug}
        documentSlug={route.documentSlug}
      />
    );
  }

  return (
    <main className="route-not-found">
      <span aria-hidden="true">404</span>
      <h1>Page not found</h1>
      <a href="/workspaces/default">Return to Default</a>
    </main>
  );
}
