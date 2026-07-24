export type UtilityBarPage = "dashboard" | "workspaces" | "archive" | null;

interface UtilityBarProps {
  current: UtilityBarPage;
  /** Scopes the Archive link to a workspace when one is in view. */
  workspaceSlug?: string | null;
}

export function UtilityBar({ current, workspaceSlug = null }: UtilityBarProps) {
  return (
    <header className="utility-bar">
      <nav className="utility-links" aria-label="Global navigation">
        <UtilityLink href="/" isCurrent={current === "dashboard"}>
          Dashboard
        </UtilityLink>
        <UtilityLink href="/workspaces" isCurrent={current === "workspaces"}>
          Workspaces
        </UtilityLink>
        <UtilityLink
          href={
            workspaceSlug
              ? `/archive?workspace=${encodeURIComponent(workspaceSlug)}`
              : "/archive"
          }
          isCurrent={current === "archive"}
        >
          Archive
        </UtilityLink>
      </nav>
    </header>
  );
}

interface UtilityLinkProps {
  children: string;
  href: string;
  isCurrent: boolean;
}

function UtilityLink({ children, href, isCurrent }: UtilityLinkProps) {
  return (
    <a
      className={isCurrent ? "active" : undefined}
      href={href}
      aria-current={isCurrent ? "page" : undefined}
    >
      {children}
    </a>
  );
}
