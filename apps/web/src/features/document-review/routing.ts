import { CollectionSlugSchema, DocumentSlugSchema } from "@pena/contracts";

export type AppRoute =
  | { kind: "home"; collectionSlug: string | null }
  | { kind: "collections" }
  | { kind: "document"; documentSlug: string }
  | { kind: "archive"; collectionSlug: string | null }
  | { kind: "not-found" };

export function readAppRoute(pathname: string, search = ""): AppRoute {
  if (pathname === "/") {
    return { kind: "home", collectionSlug: null };
  }

  if (/^\/collections\/?$/.test(pathname)) {
    return { kind: "collections" };
  }

  if (/^\/archive\/?$/.test(pathname)) {
    const requestedCollection = new URLSearchParams(search).get("collection");
    const collectionSlug = requestedCollection
      ? parseSlug(requestedCollection, CollectionSlugSchema)
      : null;
    return requestedCollection && !collectionSlug
      ? { kind: "not-found" }
      : { kind: "archive", collectionSlug };
  }

  const documentMatch = /^\/docs\/([^/]+)\/?$/.exec(pathname);

  if (documentMatch?.[1]) {
    const documentSlug = parseSlug(documentMatch[1], DocumentSlugSchema);
    return documentSlug
      ? { kind: "document", documentSlug }
      : { kind: "not-found" };
  }

  const collectionMatch = /^\/collections\/([^/]+)\/?$/.exec(pathname);

  if (collectionMatch?.[1]) {
    const collectionSlug = parseSlug(collectionMatch[1], CollectionSlugSchema);
    return collectionSlug
      ? { kind: "home", collectionSlug }
      : { kind: "not-found" };
  }

  return { kind: "not-found" };
}

export function documentHref(documentSlug: string): string {
  return `/docs/${encodeURIComponent(documentSlug)}`;
}

/** The folder view for a collection, or the dashboard for the root. */
export function collectionHref(collectionSlug: string | null): string {
  return collectionSlug === null
    ? "/"
    : `/collections/${encodeURIComponent(collectionSlug)}`;
}

export function archiveHref(collectionSlug: string | null): string {
  return collectionSlug === null
    ? "/archive"
    : `/archive?collection=${encodeURIComponent(collectionSlug)}`;
}

function parseSlug(
  value: string,
  schema: typeof CollectionSlugSchema,
): string | null {
  try {
    const parsed = schema.safeParse(decodeURIComponent(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
