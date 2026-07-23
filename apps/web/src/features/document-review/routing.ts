import { DocumentSlugSchema, WorkspaceSlugSchema } from "@pena/contracts";

export type AppRoute =
  | { kind: "workspaces" }
  | { kind: "documents"; workspaceSlug: string; documentSlug: string | null }
  | { kind: "archive"; workspaceSlug: string }
  | { kind: "not-found" };

export function readAppRoute(pathname: string): AppRoute {
  if (/^\/workspaces\/?$/.test(pathname)) {
    return { kind: "workspaces" };
  }

  const archiveMatch = /^\/workspaces\/([^/]+)\/archive\/?$/.exec(pathname);

  if (archiveMatch?.[1]) {
    const workspaceSlug = parseSlug(archiveMatch[1], WorkspaceSlugSchema);
    return workspaceSlug
      ? { kind: "archive", workspaceSlug }
      : { kind: "not-found" };
  }

  const documentMatch =
    /^\/workspaces\/([^/]+)\/documents\/([^/]+)\/?$/.exec(pathname);

  if (documentMatch?.[1] && documentMatch[2]) {
    const workspaceSlug = parseSlug(documentMatch[1], WorkspaceSlugSchema);
    const documentSlug = parseSlug(documentMatch[2], DocumentSlugSchema);
    return workspaceSlug && documentSlug
      ? { kind: "documents", workspaceSlug, documentSlug }
      : { kind: "not-found" };
  }

  const workspaceMatch = /^\/workspaces\/([^/]+)\/?$/.exec(pathname);

  if (workspaceMatch?.[1]) {
    const workspaceSlug = parseSlug(workspaceMatch[1], WorkspaceSlugSchema);
    return workspaceSlug
      ? { kind: "documents", workspaceSlug, documentSlug: null }
      : { kind: "not-found" };
  }

  return { kind: "not-found" };
}

function parseSlug(
  value: string,
  schema: typeof WorkspaceSlugSchema,
): string | null {
  try {
    const parsed = schema.safeParse(decodeURIComponent(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
