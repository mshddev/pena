import { UtilityBar } from "./components/UtilityBar";
import { ArchivePage } from "./features/archive/ArchivePage";
import { DocumentReviewPage } from "./features/document-review/DocumentReviewPage";
import { readAppRoute } from "./features/document-review/routing";
import { HomePage } from "./features/home/HomePage";
import { WorkspacesPage } from "./features/workspaces/WorkspacesPage";

export function App() {
  const route = readAppRoute(window.location.pathname, window.location.search);

  if (route.kind === "home") {
    return <HomePage workspaceSlug={null} />;
  }

  if (route.kind === "workspaces") {
    return <WorkspacesPage />;
  }

  if (route.kind === "archive") {
    return <ArchivePage workspaceSlug={route.workspaceSlug} />;
  }

  if (route.kind === "documents") {
    return route.documentSlug === null ? (
      <HomePage workspaceSlug={route.workspaceSlug} />
    ) : (
      <DocumentReviewPage
        workspaceSlug={route.workspaceSlug}
        documentSlug={route.documentSlug}
      />
    );
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
