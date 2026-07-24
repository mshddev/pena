import type { DocumentSummary, WorkspaceSummary } from "@pena/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

export interface FeedbackStat {
  total: number;
  hasRecent: boolean;
}

export type LibraryDocument = DocumentSummary;

interface WorkspaceHomeProps {
  documents: LibraryDocument[];
  error: string | null;
  feedbackStats: Record<string, FeedbackStat>;
  isLoading: boolean;
  workspaces: WorkspaceSummary[];
  /** `null` shows every workspace; a slug scopes the library to one. */
  workspaceSlug: string | null;
}

interface LibrarySection {
  key: string;
  label: string;
  href: string | null;
  documents: LibraryDocument[];
}

const RECENCY_ORDER = ["Today", "Earlier this week", "Earlier"] as const;

type RecencyName = (typeof RECENCY_ORDER)[number];

export function documentKey(document: LibraryDocument): string {
  return `${document.workspaceSlug}/${document.slug}`;
}

export function WorkspaceHome({
  documents,
  error,
  feedbackStats,
  isLoading,
  workspaces,
  workspaceSlug,
}: WorkspaceHomeProps) {
  const [query, setQuery] = useState("");
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  const isEveryWorkspace = workspaceSlug === null;
  const scopeName = isEveryWorkspace
    ? "All workspaces"
    : (workspaces.find((workspace) => workspace.slug === workspaceSlug)?.name ??
      formatSlug(workspaceSlug));

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      event.preventDefault();
      searchRef.current?.focus();
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!isSwitcherOpen) {
      return;
    }

    function handleDismiss(event: MouseEvent | KeyboardEvent): void {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setIsSwitcherOpen(false);
        }
        return;
      }

      if (!switcherRef.current?.contains(event.target as Node)) {
        setIsSwitcherOpen(false);
      }
    }

    window.addEventListener("pointerdown", handleDismiss);
    window.addEventListener("keydown", handleDismiss);
    return () => {
      window.removeEventListener("pointerdown", handleDismiss);
      window.removeEventListener("keydown", handleDismiss);
    };
  }, [isSwitcherOpen]);

  const sections = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matches = documents
      .filter(
        (document) =>
          search.length === 0 ||
          document.slug.toLowerCase().includes(search) ||
          formatSlug(document.slug).toLowerCase().includes(search),
      )
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    // Across every workspace the workspace itself is the useful grouping;
    // inside one workspace recency is.
    if (isEveryWorkspace) {
      return workspaces
        .map((workspace) => ({
          key: workspace.slug,
          label: workspace.name,
          href: `/workspaces/${workspace.slug}`,
          documents: matches.filter(
            (document) => document.workspaceSlug === workspace.slug,
          ),
        }))
        .filter(
          (section) => section.documents.length > 0 || search.length === 0,
        );
    }

    const now = new Date();

    return RECENCY_ORDER.map((name) => ({
      key: name,
      label: name,
      href: null,
      documents: matches.filter(
        (document) => recencyFor(document.updatedAt, now) === name,
      ),
    })).filter((section) => section.documents.length > 0);
  }, [documents, isEveryWorkspace, query, workspaces]);

  const recentCount = documents.filter(
    (document) => feedbackStats[documentKey(document)]?.hasRecent,
  ).length;
  const isFiltered = query.trim().length > 0;
  const matchCount = sections.reduce(
    (total, section) => total + section.documents.length,
    0,
  );

  return (
    <div className="home-shell">
      <div className="home-utility">
        <div className="home-utility-links">
          <a
            href={
              isEveryWorkspace
                ? "/archive"
                : `/archive?workspace=${encodeURIComponent(workspaceSlug)}`
            }
          >
            Archive
          </a>
          <a href="/workspaces">Workspaces</a>
        </div>
      </div>

      <main className="home-main">
        <header className="home-hero">
          <div className="home-switcher" ref={switcherRef}>
            <h1 className="home-title">
              <button
                className="home-switcher-trigger"
                type="button"
                aria-expanded={isSwitcherOpen}
                aria-haspopup="true"
                onClick={() => setIsSwitcherOpen((open) => !open)}
              >
                {scopeName}
                <CaretIcon />
              </button>
            </h1>

            {isSwitcherOpen ? (
              <nav className="home-switcher-menu" aria-label="Switch workspace">
                <a
                  className={`home-switcher-option${
                    isEveryWorkspace ? " active" : ""
                  }`}
                  href="/"
                  aria-current={isEveryWorkspace ? "page" : undefined}
                >
                  <span>All workspaces</span>
                  <span className="home-switcher-count">
                    {workspaces.length}
                  </span>
                </a>
                {workspaces.map((workspace) => (
                  <a
                    className={`home-switcher-option${
                      workspace.slug === workspaceSlug ? " active" : ""
                    }`}
                    href={`/workspaces/${workspace.slug}`}
                    aria-current={
                      workspace.slug === workspaceSlug ? "page" : undefined
                    }
                    key={workspace.slug}
                  >
                    <span>{workspace.name}</span>
                    <span className="home-switcher-count">
                      {workspace.documentCount}
                    </span>
                  </a>
                ))}
                <a className="home-switcher-manage" href="/workspaces">
                  Manage workspaces
                </a>
              </nav>
            ) : null}
          </div>

          {error ? null : (
            <p className="home-summary">
              {isLoading
                ? "Loading documents"
                : summarize(
                    documents.length,
                    isEveryWorkspace ? workspaces.length : null,
                    recentCount,
                  )}
            </p>
          )}
        </header>

        {!isLoading && !error && documents.length > 0 ? (
          <div className="home-search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isEveryWorkspace
                  ? "Search every workspace"
                  : "Search documents"
              }
              aria-label="Search documents"
              autoComplete="off"
            />
            {query.length === 0 ? (
              <kbd className="home-search-hint" aria-hidden="true">
                /
              </kbd>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <div className="home-loading" aria-label="Loading documents">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : error ? (
          <p className="home-error" role="status">
            {error}
          </p>
        ) : documents.length === 0 ? (
          <OnboardingCard />
        ) : matchCount === 0 ? (
          <p className="home-no-matches" role="status">
            No documents match “{query.trim()}”.
          </p>
        ) : (
          sections.map((section) => (
            <LibrarySectionView
              feedbackStats={feedbackStats}
              key={section.key}
              section={section}
            />
          ))
        )}

        {!isLoading && !error && documents.length > 0 && !isFiltered ? (
          <a
            className="home-archive-link"
            href={
              isEveryWorkspace
                ? "/archive"
                : `/archive?workspace=${encodeURIComponent(workspaceSlug)}`
            }
          >
            <ArchiveIcon />
            <span>Archived documents</span>
            <ArrowIcon />
          </a>
        ) : null}
      </main>

      <footer className="home-footer">
        <a className="home-footer-mark" href="/">
          pena
        </a>
        <span>collaborate and review docs with Claude Code</span>
      </footer>
    </div>
  );
}

interface LibrarySectionViewProps {
  feedbackStats: Record<string, FeedbackStat>;
  section: LibrarySection;
}

function LibrarySectionView({
  feedbackStats,
  section,
}: LibrarySectionViewProps) {
  return (
    <section className="home-group">
      <h2 className="home-group-label">
        {section.href ? (
          <a href={section.href}>{section.label}</a>
        ) : (
          section.label
        )}
        <span>{section.documents.length}</span>
      </h2>
      {section.documents.length === 0 ? (
        <p className="home-group-empty">No documents yet</p>
      ) : (
        <div className="document-card-grid">
          {section.documents.map((document) => (
            <DocumentCard
              document={document}
              feedback={feedbackStats[documentKey(document)]}
              key={documentKey(document)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface DocumentCardProps {
  document: LibraryDocument;
  feedback: FeedbackStat | undefined;
}

function DocumentCard({ document, feedback }: DocumentCardProps) {
  const feedbackTotal = feedback?.total ?? 0;

  return (
    <a
      className="document-card"
      href={`/workspaces/${document.workspaceSlug}/documents/${document.slug}`}
    >
      <span className="document-card-title">{formatSlug(document.slug)}</span>
      <code className="document-card-slug">{document.slug}</code>
      <time className="document-card-time" dateTime={document.updatedAt}>
        {formatRelativeTime(document.updatedAt)}
      </time>
      <span className="document-card-chips">
        <span className="document-chip">v{document.version}</span>
        {feedbackTotal > 0 ? (
          <span
            className={`document-chip feedback${
              feedback?.hasRecent ? " recent" : ""
            }`}
          >
            {feedbackTotal} {feedbackTotal === 1 ? "note" : "notes"}
          </span>
        ) : null}
      </span>
      <ArrowIcon />
    </a>
  );
}

const ONBOARDING_STEPS = [
  {
    title: "Publish",
    detail: "Ask Claude to publish any Markdown doc.",
  },
  {
    title: "Review",
    detail: "Highlight passages and leave comments here.",
  },
  {
    title: "Send back",
    detail: "Claude reads your feedback and revises.",
  },
];

function OnboardingCard() {
  return (
    <section className="home-onboarding">
      <h2>Publish your first document</h2>
      <p className="home-onboarding-lede">
        Pena reviews Markdown documents that Claude publishes for you.
      </p>
      <ol className="home-steps">
        {ONBOARDING_STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="home-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <strong>{step.title}</strong>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>
      <code className="home-example">publish this plan to Pena</code>
    </section>
  );
}

function summarize(
  documentCount: number,
  workspaceCount: number | null,
  recentCount: number,
): string {
  const parts = [
    `${documentCount} ${documentCount === 1 ? "document" : "documents"}`,
  ];

  if (workspaceCount !== null) {
    parts[0] += ` across ${workspaceCount} ${
      workspaceCount === 1 ? "workspace" : "workspaces"
    }`;
  }

  if (recentCount > 0) {
    parts.push(`${recentCount} with recent feedback`);
  }

  return parts.join(" · ");
}

function recencyFor(updatedAt: string, now: Date): RecencyName {
  const value = new Date(updatedAt);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (value >= startOfToday) {
    return "Today";
  }

  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  return value >= startOfWeek ? "Earlier this week" : "Earlier";
}

function formatSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function formatRelativeTime(date: string): string {
  const value = new Date(date);
  const minutes = Math.round((Date.now() - value.getTime()) / 60_000);

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)}h ago`;
  }

  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (value.getFullYear() !== new Date().getFullYear()) {
    options.year = "numeric";
  }

  return new Intl.DateTimeFormat(undefined, options).format(value);
}

function CaretIcon() {
  return (
    <svg className="home-caret" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6.5 4 4 4-4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="home-search-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9" />
      <path d="m9 4 4 4-4 4" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg className="archive-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5h11v8h-11z" />
      <path d="M2 2.5h12V5H2z" />
      <path d="M6 8h4" />
    </svg>
  );
}
