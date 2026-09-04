import { archiveHref } from "../features/document-review/routing";

export type UtilityBarPage = "dashboard" | "collections" | "archive" | null;

interface UtilityBarProps {
  current: UtilityBarPage;
  /** Scopes the Archive link to a collection when one is in view. */
  collectionSlug?: string | null;
}

export function UtilityBar({
  current,
  collectionSlug = null,
}: UtilityBarProps) {
  return (
    <header className="utility-bar">
      <nav className="utility-links" aria-label="Global navigation">
        <UtilityLink href="/" isCurrent={current === "dashboard"}>
          Dashboard
        </UtilityLink>
        <UtilityLink
          href="/collections"
          isCurrent={current === "collections"}
        >
          Collections
        </UtilityLink>
        <UtilityLink
          href={archiveHref(collectionSlug)}
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
