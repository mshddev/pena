import type { Collection } from "@pena/contracts";

/**
 * Helpers for the collection tree. The server returns collections as a flat
 * list with a `parentSlug` on each; pages derive folders, paths, and subtrees
 * from that list instead of asking the server for each level.
 */

export function findCollection<T extends Collection>(
  collections: T[],
  slug: string | null,
): T | null {
  if (slug === null) {
    return null;
  }

  return collections.find((collection) => collection.slug === slug) ?? null;
}

/** Direct children of a collection, or the root collections for `null`. */
export function childCollections<T extends Collection>(
  collections: T[],
  parentSlug: string | null,
): T[] {
  return collections.filter(
    (collection) => collection.parentSlug === parentSlug,
  );
}

/** Ancestors from the root down to and including the collection itself. */
export function collectionPath<T extends Collection>(
  collections: T[],
  slug: string | null,
): T[] {
  const path: T[] = [];
  const seen = new Set<string>();
  let cursor = findCollection(collections, slug);

  while (cursor && !seen.has(cursor.slug)) {
    seen.add(cursor.slug);
    path.unshift(cursor);
    cursor = findCollection(collections, cursor.parentSlug);
  }

  return path;
}

/** The collection and everything nested inside it, depth first. */
export function collectionSubtree<T extends Collection>(
  collections: T[],
  slug: string | null,
): T[] {
  const subtree: T[] = [];
  const root = findCollection(collections, slug);

  if (root) {
    subtree.push(root);
  }

  const queue = childCollections(collections, slug);
  const seen = new Set<string>(root ? [root.slug] : []);

  while (queue.length > 0) {
    const next = queue.shift();

    if (!next || seen.has(next.slug)) {
      continue;
    }

    seen.add(next.slug);
    subtree.push(next);
    queue.unshift(...childCollections(collections, next.slug));
  }

  return subtree;
}

/** Human-readable path such as "Mamikos / Payments" for breadcrumbs. */
export function formatCollectionPath(
  collections: Collection[],
  slug: string | null,
): string {
  const path = collectionPath(collections, slug);
  return path.length === 0
    ? ""
    : path.map((collection) => collection.name).join(" / ");
}

export interface CollectionTreeNode<T extends Collection> {
  collection: T;
  depth: number;
  children: CollectionTreeNode<T>[];
}

/** Nested tree ordered by name at every level. */
export function buildCollectionTree<T extends Collection>(
  collections: T[],
  parentSlug: string | null = null,
  depth = 0,
  seen = new Set<string>(),
): CollectionTreeNode<T>[] {
  return childCollections(collections, parentSlug)
    .filter((collection) => !seen.has(collection.slug))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    )
    .map((collection) => {
      const nextSeen = new Set(seen);
      nextSeen.add(collection.slug);
      return {
        collection,
        depth,
        children: buildCollectionTree(
          collections,
          collection.slug,
          depth + 1,
          nextSeen,
        ),
      };
    });
}

/** Depth-first flattening of the tree, for select menus and lists. */
export function flattenCollectionTree<T extends Collection>(
  nodes: CollectionTreeNode<T>[],
): CollectionTreeNode<T>[] {
  return nodes.flatMap((node) => [node, ...flattenCollectionTree(node.children)]);
}
