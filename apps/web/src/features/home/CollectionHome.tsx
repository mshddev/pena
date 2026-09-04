import type { CollectionSummary, DocumentSummary } from "@pena/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  childCollections,
  collectionPath,
  collectionSubtree,
  findCollection,
  formatCollectionPath,
} from "../../collections";
import { UtilityBar } from "../../components/UtilityBar";
import { formatRelativeTime } from "../../format";
import { isSearchShortcut, searchShortcutLabel } from "../../shortcuts";
import { collectionHref, documentHref } from "../document-review/routing";

export interface FeedbackStat {
  total: number;
  hasRecent: boolean;
}

export type LibraryDocument = DocumentSummary;

interface CollectionHomeProps {
  collections: CollectionSummary[];
  /** `null` shows the root; a slug opens that collection like a folder. */
  collectionSlug: string | null;
  documents: LibraryDocument[];
  error: string | null;
  feedbackStats: Record<string, FeedbackStat>;
  isLoading: boolean;
}

interface LibrarySection {
  key: string;
  label: string;
  documents: LibraryDocument[];
}

const RECENCY_ORDER = ["Today", "Earlier this week", "Earlier"] as const;

type RecencyName = (typeof RECENCY_ORDER)[number];

export function CollectionHome({
  collections,
  collectionSlug,
  documents,
  error,
  feedbackStats,
  isLoading,
}: CollectionHomeProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const isRoot = collectionSlug === null;
  const currentCollection = findCollection(collections, collectionSlug);
  const path = useMemo(
    () => collectionPath(collections, collectionSlug),
    [collections, collectionSlug],
  );
  const scopeName = isRoot
    ? "All documents"
    : (currentCollection?.name ?? formatSlug(collectionSlug));

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (!isSearchShortcut(event)) {
        return;
      }

      event.preventDefault();
      searchRef.current?.focus();
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const folders = useMemo(
    () =>
      childCollections(collections, collectionSlug)
        .slice()
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
          }),
        ),
    [collections, collectionSlug],
  );

  // Browsing shows what sits directly in this folder. Searching reaches into
  // every folder nested below it, the way a file search does.
  const search = query.trim().toLowerCase();
  const isSearching = search.length > 0;
  const scopedDocuments = useMemo(() => {
    if (isRoot) {
      return isSearching
        ? documents
        : documents.filter((document) => document.collectionSlug === null);
    }

    if (isSearching) {
      const subtree = new Set(
        collectionSubtree(collections, collectionSlug).map(
          (collection) => collection.slug,
        ),
      );
      return documents.filter(
        (document) =>
          document.collectionSlug !== null &&
          subtree.has(document.collectionSlug),
      );
    }

    return documents.filter(
      (document) => document.collectionSlug === collectionSlug,
    );
  }, [collectionSlug, collections, documents, isRoot, isSearching]);

  const sections = useMemo(() => {
    const matches = scopedDocuments
      .filter(
        (document) =>
          !isSearching ||
          document.slug.toLowerCase().includes(search) ||
          formatSlug(document.slug).toLowerCase().includes(search) ||
          document.title.toLowerCase().includes(search) ||
          document.excerpt.toLowerCase().includes(search) ||
          formatCollectionPath(collections, document.collectionSlug)
            .toLowerCase()
            .includes(search),
      )
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    if (isSearching) {
      return [{ key: "matches", label: "Matches", documents: matches }];
    }

    const now = new Date();

    return RECENCY_ORDER.map((name) => ({
      key: name,
      label: name,
      documents: matches.filter(
        (document) => recencyFor(document.updatedAt, now) === name,
      ),
    })).filter((section) => section.documents.length > 0);
  }, [collections, isSearching, scopedDocuments, search]);

  const recentCount = scopedDocuments.filter(
    (document) => feedbackStats[document.slug]?.hasRecent,
  ).length;
  const matchCount = sections.reduce(
    (total, section) => total + section.documents.length,
    0,
  );
  const isUnknownCollection =
    !isLoading && !error && !isRoot && currentCollection === null;
  const isEmpty =
    !isLoading && !error && documents.length === 0 && collections.length === 0;
  const isFolderEmpty =
    !isLoading &&
    !error &&
    !isEmpty &&
    !isSearching &&
    folders.length === 0 &&
    scopedDocuments.length === 0;

  if (isUnknownCollection) {
    return (
      <div className="app-shell">
        <UtilityBar current={null} />
        <main className="route-not-found">
          <span aria-hidden="true">404</span>
          <h1>Collection not found</h1>
          <a href="/">Return to the dashboard</a>
        </main>
      </div>
    );
  }

  return (
    <div className="home-shell">
      <UtilityBar
        current={isRoot ? "dashboard" : null}
        collectionSlug={collectionSlug}
      />

      <main className="home-main">
        <header className="home-hero">
          {isRoot ? null : (
          <nav className="home-breadcrumb" aria-label="Collection path">
            <a href="/">All documents</a>
            {path.map((collection) => {
              const isCurrent = collection.slug === collectionSlug;

              return (
                <span className="home-breadcrumb-step" key={collection.slug}>
                  <span aria-hidden="true">/</span>
                  <a
                    className={isCurrent ? "active" : undefined}
                    href={collectionHref(collection.slug)}
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    {collection.name}
                  </a>
                </span>
              );
            })}
          </nav>
          )}

          <div className="home-heading-row">
            <h1 className="home-title">{scopeName}</h1>
            <a className="home-manage-link" href="/collections">
              Manage collections
            </a>
          </div>

          {error ? null : (
            <p className="home-summary">
              {isLoading
                ? "Loading documents"
                : summarize(
                    scopedDocuments.length,
                    folders.length,
                    recentCount,
                    isSearching,
                  )}
            </p>
          )}
        </header>

        {!isLoading && !error && !isEmpty ? (
          <div className="home-search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isRoot ? "Search every document" : `Search ${scopeName}`
              }
              aria-label="Search documents"
              autoComplete="off"
            />
            {query.length === 0 ? (
              <kbd className="home-search-hint" aria-hidden="true">
                {searchShortcutLabel()}
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
        ) : isEmpty ? (
          <OnboardingCard />
        ) : (
          <>
            {!isSearching && folders.length > 0 ? (
              <section className="home-group">
                <h2 className="home-group-label">
                  Collections
                  <span>{folders.length}</span>
                </h2>
                <div className="collection-folder-list">
                  {folders.map((folder) => (
                    <FolderEntry
                      collections={collections}
                      documents={documents}
                      folder={folder}
                      key={folder.slug}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {isFolderEmpty ? (
              <p className="home-no-matches" role="status">
                {isRoot
                  ? "No documents at the root yet."
                  : `${scopeName} has no documents or collections yet.`}
              </p>
            ) : isSearching && matchCount === 0 ? (
              <p className="home-no-matches" role="status">
                No documents match “{query.trim()}”.
              </p>
            ) : (
              sections.map((section) => (
                <LibrarySectionView
                  collections={collections}
                  feedbackStats={feedbackStats}
                  key={section.key}
                  section={section}
                  showCollection={isSearching}
                />
              ))
            )}
          </>
        )}
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

interface FolderEntryProps {
  collections: CollectionSummary[];
  documents: LibraryDocument[];
  folder: CollectionSummary;
}

function FolderEntry({ collections, documents, folder }: FolderEntryProps) {
  // A folder counts everything nested below it, so a parent with only
  // subfolders still reads as full.
  const subtree = new Set(
    collectionSubtree(collections, folder.slug).map(
      (collection) => collection.slug,
    ),
  );
  const documentCount = documents.filter(
    (document) =>
      document.collectionSlug !== null && subtree.has(document.collectionSlug),
  ).length;

  return (
    <a className="collection-folder" href={collectionHref(folder.slug)}>
      <FolderIcon />
      <span className="collection-folder-name">{folder.name}</span>
      <span className="collection-folder-meta">
        {documentCount} {documentCount === 1 ? "document" : "documents"}
        {folder.childCount > 0
          ? ` · ${folder.childCount} ${
              folder.childCount === 1 ? "collection" : "collections"
            }`
          : ""}
      </span>
    </a>
  );
}

interface LibrarySectionViewProps {
  collections: CollectionSummary[];
  feedbackStats: Record<string, FeedbackStat>;
  section: LibrarySection;
  showCollection: boolean;
}

function LibrarySectionView({
  collections,
  feedbackStats,
  section,
  showCollection,
}: LibrarySectionViewProps) {
  return (
    <section className="home-group">
      <h2 className="home-group-label">
        {section.label}
        <span>{section.documents.length}</span>
      </h2>
      <div className="document-list">
        {section.documents.map((document) => (
          <DocumentEntry
            collectionName={
              showCollection
                ? formatCollectionPath(collections, document.collectionSlug)
                : null
            }
            document={document}
            feedback={feedbackStats[document.slug]}
            key={document.slug}
          />
        ))}
      </div>
    </section>
  );
}

interface DocumentEntryProps {
  collectionName: string | null;
  document: LibraryDocument;
  feedback: FeedbackStat | undefined;
}

function DocumentEntry({
  collectionName,
  document,
  feedback,
}: DocumentEntryProps) {
  const feedbackTotal = feedback?.total ?? 0;

  return (
    <a className="document-entry" href={documentHref(document.slug)}>
      <span className="document-entry-head">
        <span className="document-entry-title">{document.title}</span>
        <ArrowIcon />
      </span>

      {document.excerpt ? (
        <span className="document-entry-excerpt">{document.excerpt}</span>
      ) : null}

      <span className="document-entry-meta">
        <span className="document-chip">v{document.version}</span>
        <time dateTime={document.updatedAt}>
          {formatRelativeTime(document.updatedAt)}
        </time>
        {collectionName ? (
          <span className="document-chip collection">{collectionName}</span>
        ) : null}
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
  folderCount: number,
  recentCount: number,
  isSearching: boolean,
): string {
  const parts = [
    `${documentCount} ${documentCount === 1 ? "document" : "documents"}`,
  ];

  if (!isSearching && folderCount > 0) {
    parts[0] += ` and ${folderCount} ${
      folderCount === 1 ? "collection" : "collections"
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

function FolderIcon() {
  return (
    <svg className="collection-folder-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
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
