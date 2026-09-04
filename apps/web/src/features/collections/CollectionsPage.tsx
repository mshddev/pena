import type { CollectionSummary } from "@pena/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  createCollection,
  deleteCollection,
  fetchCollections,
  updateCollection,
} from "../../api";
import {
  buildCollectionTree,
  collectionSubtree,
  flattenCollectionTree,
  formatCollectionPath,
  type CollectionTreeNode,
} from "../../collections";
import { UtilityBar } from "../../components/UtilityBar";
import { formatRelativeTime } from "../../format";
import { isSearchShortcut, searchShortcutLabel } from "../../shortcuts";
import { archiveHref, collectionHref } from "../document-review/routing";
import type { Notice } from "../document-review/types";

/** Select value that stands for the root, since a slug can never be empty. */
const ROOT_OPTION = "";

export function CollectionsPage() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState(ROOT_OPTION);
  const [openMenuSlug, setOpenMenuSlug] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [movingSlug, setMovingSlug] = useState<string | null>(null);
  const [moveParent, setMoveParent] = useState(ROOT_OPTION);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

  const loadCollections = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetchCollections();
      setCollections(response.collections);
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not load collections.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    window.document.title = "Collections · Pena";
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (!isSearchShortcut(event)) {
        return;
      }

      event.preventDefault();
      filterRef.current?.focus();
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (isCreating) {
      createRef.current?.focus();
    }
  }, [isCreating]);

  useEffect(() => {
    if (!isCreating) {
      return;
    }

    function handleDismiss(event: MouseEvent | KeyboardEvent): void {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setIsCreating(false);
        }
        return;
      }

      const target = event.target;

      if (
        !(target instanceof Element) ||
        !target.closest(".collection-create")
      ) {
        setIsCreating(false);
      }
    }

    window.addEventListener("pointerdown", handleDismiss);
    window.addEventListener("keydown", handleDismiss);
    return () => {
      window.removeEventListener("pointerdown", handleDismiss);
      window.removeEventListener("keydown", handleDismiss);
    };
  }, [isCreating]);

  useEffect(() => {
    if (!openMenuSlug) {
      return;
    }

    function handleDismiss(event: MouseEvent | KeyboardEvent): void {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setOpenMenuSlug(null);
        }
        return;
      }

      const target = event.target;

      if (
        !(target instanceof Element) ||
        !target.closest(".collection-card-menu")
      ) {
        setOpenMenuSlug(null);
      }
    }

    window.addEventListener("pointerdown", handleDismiss);
    window.addEventListener("keydown", handleDismiss);
    return () => {
      window.removeEventListener("pointerdown", handleDismiss);
      window.removeEventListener("keydown", handleDismiss);
    };
  }, [openMenuSlug]);

  const tree = useMemo(() => buildCollectionTree(collections), [collections]);
  const orderedNodes = useMemo(() => flattenCollectionTree(tree), [tree]);

  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (search.length === 0) {
      return orderedNodes;
    }

    // A filter flattens the tree: a match shows with its full path so a
    // nested hit still reads in context.
    return orderedNodes
      .filter(
        ({ collection }) =>
          collection.name.toLowerCase().includes(search) ||
          collection.slug.toLowerCase().includes(search) ||
          formatCollectionPath(collections, collection.slug)
            .toLowerCase()
            .includes(search),
      )
      .map((node) => ({ ...node, depth: 0 }));
  }, [collections, orderedNodes, query]);

  function parentOptionsFor(excludedSlug: string | null) {
    // A collection cannot move into itself or anything nested inside it.
    const excluded = new Set(
      excludedSlug === null
        ? []
        : collectionSubtree(collections, excludedSlug).map(
            (collection) => collection.slug,
          ),
    );
    return orderedNodes.filter(
      ({ collection }) => !excluded.has(collection.slug),
    );
  }

  function beginCreate(parentSlug: string): void {
    setNewParent(parentSlug);
    setIsCreating(true);
    setOpenMenuSlug(null);
    setEditingSlug(null);
    setMovingSlug(null);
    setDeleteCandidate(null);
    setNotice(null);
  }

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!newName.trim()) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const created = await createCollection(
        newName,
        newParent === ROOT_OPTION ? null : newParent,
      );
      setNewName("");
      setNewParent(ROOT_OPTION);
      setIsCreating(false);
      await loadCollections();
      setNotice({
        kind: "success",
        message: `${created.name} created.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not create collection.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function beginRename(collection: CollectionSummary): void {
    setEditingSlug(collection.slug);
    setEditingName(collection.name);
    setMovingSlug(null);
    setDeleteCandidate(null);
    setOpenMenuSlug(null);
    setNotice(null);
  }

  async function handleRename(event: FormEvent, slug: string): Promise<void> {
    event.preventDefault();

    if (!editingName.trim()) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const renamed = await updateCollection(slug, { name: editingName });
      setCollections((current) =>
        current.map((collection) =>
          collection.slug === slug
            ? {
                ...collection,
                name: renamed.name,
                updatedAt: renamed.updatedAt,
              }
            : collection,
        ),
      );
      setEditingSlug(null);
      setNotice({ kind: "success", message: `${renamed.name} saved.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not rename collection.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function beginMove(collection: CollectionSummary): void {
    setMovingSlug(collection.slug);
    setMoveParent(collection.parentSlug ?? ROOT_OPTION);
    setEditingSlug(null);
    setDeleteCandidate(null);
    setOpenMenuSlug(null);
    setNotice(null);
  }

  async function handleMove(event: FormEvent, slug: string): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setNotice(null);

    try {
      const moved = await updateCollection(slug, {
        parentSlug: moveParent === ROOT_OPTION ? null : moveParent,
      });
      await loadCollections();
      setMovingSlug(null);
      setNotice({
        kind: "success",
        message:
          moved.parentSlug === null
            ? `${moved.name} moved to the root.`
            : `${moved.name} moved into ${
                formatCollectionPath(collections, moved.parentSlug) ||
                moved.parentSlug
              }.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not move collection.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function beginDelete(slug: string): void {
    setDeleteCandidate(slug);
    setDeleteConfirmation("");
    setEditingSlug(null);
    setMovingSlug(null);
    setOpenMenuSlug(null);
    setNotice(null);
  }

  async function handleDelete(slug: string): Promise<void> {
    if (deleteConfirmation !== slug) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      await deleteCollection(slug);
      setCollections((current) =>
        current.filter((collection) => collection.slug !== slug),
      );
      setDeleteCandidate(null);
      setDeleteConfirmation("");
      setNotice({ kind: "success", message: `${slug} deleted.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not delete collection.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="collection-admin-shell">
      <UtilityBar current="collections" />

      <main className="collection-admin">
        <header className="collection-admin-heading">
          <div className="collection-admin-copy">
            <h1>Collections</h1>
            <p>Folders for your documents. Collections can nest.</p>
            <p className="collection-admin-count">
              {isLoading
                ? "Loading collections"
                : `${collections.length} ${
                    collections.length === 1 ? "collection" : "collections"
                  }`}
            </p>
          </div>

          <div className="collection-create">
            <button
              className="collection-create-trigger"
              type="button"
              aria-expanded={isCreating}
              aria-haspopup="true"
              onClick={() => {
                if (isCreating) {
                  setIsCreating(false);
                } else {
                  beginCreate(ROOT_OPTION);
                }
              }}
            >
              <span aria-hidden="true">+</span>
              New collection
            </button>

            {isCreating ? (
              <form
                className="collection-create-form"
                onSubmit={(event) => void handleCreate(event)}
              >
                <label htmlFor="collection-name">New collection</label>
                <p>Group related documents, or nest it inside another.</p>
                <input
                  id="collection-name"
                  ref={createRef}
                  type="text"
                  maxLength={80}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Research"
                  autoComplete="off"
                />
                <label htmlFor="collection-parent">Inside</label>
                <select
                  id="collection-parent"
                  value={newParent}
                  onChange={(event) => setNewParent(event.target.value)}
                >
                  <option value={ROOT_OPTION}>Root</option>
                  {orderedNodes.map((node) => (
                    <ParentOption key={node.collection.slug} node={node} />
                  ))}
                </select>
                <div>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setIsCreating(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={isSaving || !newName.trim()}>
                    Create
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </header>

        <div className="collection-filter">
          <SearchIcon />
          <input
            ref={filterRef}
            type="search"
            aria-label="Filter collections"
            placeholder="Filter collections"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="collection-filter-hint" aria-hidden="true">
            {searchShortcutLabel()}
          </kbd>
        </div>

        {notice ? (
          <p className={`archive-notice ${notice.kind}`} role="status">
            {notice.message}
          </p>
        ) : null}

        {isLoading ? (
          <div
            className="collection-admin-loading"
            aria-label="Loading collections"
          >
            <span />
            <span />
            <span />
          </div>
        ) : matches.length === 0 ? (
          <p className="collection-no-matches">
            {query.trim()
              ? `No collections match “${query.trim()}”.`
              : "No collections yet. Documents live at the root until you file them."}
          </p>
        ) : (
          <div className="collection-tree" role="list">
            {matches.map(({ collection, depth }) => {
              const isEditing = editingSlug === collection.slug;
              const isMoving = movingSlug === collection.slug;
              const isDeleting = deleteCandidate === collection.slug;
              const isMenuOpen = openMenuSlug === collection.slug;
              const isOccupied =
                collection.documentCount > 0 || collection.childCount > 0;
              const pathLabel = formatCollectionPath(
                collections,
                collection.parentSlug,
              );

              return (
                <article
                  className="collection-card"
                  key={collection.slug}
                  role="listitem"
                  style={{ marginLeft: `${depth * 1.5}rem` }}
                >
                  <div className="collection-card-top">
                    <span
                      className="collection-monogram"
                      style={monogramTint(collection.slug)}
                      aria-hidden="true"
                    >
                      {collection.name.charAt(0).toUpperCase()}
                    </span>

                    <div className="collection-card-menu">
                      <button
                        className="collection-menu-trigger"
                        type="button"
                        aria-label={`Actions for ${collection.name}`}
                        aria-expanded={isMenuOpen}
                        aria-haspopup="true"
                        onClick={() =>
                          setOpenMenuSlug(isMenuOpen ? null : collection.slug)
                        }
                      >
                        <MoreIcon />
                      </button>

                      {isMenuOpen ? (
                        <div className="collection-menu">
                          <button
                            type="button"
                            onClick={() => beginCreate(collection.slug)}
                          >
                            New collection inside
                          </button>
                          <button
                            type="button"
                            onClick={() => beginRename(collection)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => beginMove(collection)}
                          >
                            Move
                          </button>
                          <button
                            className="collection-delete-trigger"
                            type="button"
                            onClick={() => beginDelete(collection.slug)}
                            disabled={isOccupied}
                            aria-describedby={
                              isOccupied
                                ? `delete-blocked-${collection.slug}`
                                : undefined
                            }
                          >
                            Delete
                            {isOccupied ? <InfoIcon /> : null}
                          </button>

                          {isOccupied ? (
                            <p
                              className="collection-menu-note"
                              id={`delete-blocked-${collection.slug}`}
                            >
                              Move out every document and nested collection
                              first. Archived documents count too; find them
                              in{" "}
                              <a href={archiveHref(collection.slug)}>
                                the archive
                              </a>
                              .
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="collection-card-name">
                    <h2>{collection.name}</h2>
                  </div>
                  <code className="collection-card-slug">
                    {collection.slug}
                  </code>
                  {pathLabel ? (
                    <p className="collection-card-path">In {pathLabel}</p>
                  ) : null}
                  <p className="collection-card-time">
                    Updated {formatRelativeTime(collection.updatedAt)}
                  </p>

                  <div className="collection-card-foot">
                    <div
                      className={`collection-document-count${
                        collection.documentCount === 0 ? " empty" : ""
                      }`}
                    >
                      <strong>{collection.documentCount}</strong>
                      <span>
                        {collection.documentCount === 1
                          ? "document"
                          : "documents"}
                      </span>
                      {collection.childCount > 0 ? (
                        <span className="collection-child-count">
                          · {collection.childCount}{" "}
                          {collection.childCount === 1
                            ? "collection"
                            : "collections"}
                        </span>
                      ) : null}
                    </div>

                    <a
                      className="collection-open-link"
                      href={collectionHref(collection.slug)}
                    >
                      Open
                    </a>
                  </div>

                  {isEditing ? (
                    <form
                      className="collection-inline-editor"
                      onSubmit={(event) =>
                        void handleRename(event, collection.slug)
                      }
                    >
                      <label htmlFor={`rename-${collection.slug}`}>
                        Collection name
                      </label>
                      <input
                        id={`rename-${collection.slug}`}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        maxLength={80}
                        autoFocus
                      />
                      <div>
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() => setEditingSlug(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSaving || !editingName.trim()}
                        >
                          Save name
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {isMoving ? (
                    <form
                      className="collection-inline-editor"
                      onSubmit={(event) =>
                        void handleMove(event, collection.slug)
                      }
                    >
                      <label htmlFor={`move-${collection.slug}`}>
                        Move {collection.name} into
                      </label>
                      <select
                        id={`move-${collection.slug}`}
                        value={moveParent}
                        onChange={(event) => setMoveParent(event.target.value)}
                        autoFocus
                      >
                        <option value={ROOT_OPTION}>Root</option>
                        {parentOptionsFor(collection.slug).map((node) => (
                          <ParentOption
                            key={node.collection.slug}
                            node={node}
                          />
                        ))}
                      </select>
                      <div>
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() => setMovingSlug(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={
                            isSaving ||
                            moveParent ===
                              (collection.parentSlug ?? ROOT_OPTION)
                          }
                        >
                          Move collection
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {isDeleting ? (
                    <div className="collection-delete-confirmation">
                      <div>
                        <strong>Delete {collection.name}?</strong>
                        <p>
                          Type <code>{collection.slug}</code> to confirm.
                        </p>
                      </div>
                      <input
                        aria-label={`Type ${collection.slug} to confirm`}
                        value={deleteConfirmation}
                        onChange={(event) =>
                          setDeleteConfirmation(event.target.value)
                        }
                        autoFocus
                        autoComplete="off"
                      />
                      <div>
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() => setDeleteCandidate(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="confirm-delete-button"
                          type="button"
                          disabled={
                            isSaving || deleteConfirmation !== collection.slug
                          }
                          onClick={() => void handleDelete(collection.slug)}
                        >
                          Delete collection
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer className="collection-admin-footer">
        <a className="home-footer-mark" href="/">
          pena
        </a>
        <span>collaborate and review docs with Claude Code</span>
      </footer>
    </div>
  );
}

interface ParentOptionProps {
  node: CollectionTreeNode<CollectionSummary>;
}

function ParentOption({ node }: ParentOptionProps) {
  return (
    <option value={node.collection.slug}>
      {`${"\u00a0\u00a0".repeat(node.depth)}${node.collection.name}`}
    </option>
  );
}

/**
 * Colours the monogram from the slug so a collection keeps the same hue
 * between visits and neighbouring cards stay distinguishable at a glance.
 */
function monogramTint(slug: string): { background: string; color: string } {
  let hue = 0;

  for (let index = 0; index < slug.length; index += 1) {
    hue = (hue * 31 + slug.charCodeAt(index)) % 360;
  }

  return {
    background: `hsl(${hue} 60% 60% / 14%)`,
    color: `hsl(${hue} 72% 76%)`,
  };
}

function SearchIcon() {
  return (
    <svg className="collection-filter-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="collection-menu-info" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.4v3.4" />
      <path d="M8 5.2v.1" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="3.4" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="8" cy="12.6" r="1.25" />
    </svg>
  );
}
