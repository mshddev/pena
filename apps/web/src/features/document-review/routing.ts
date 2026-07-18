import { DocumentSlugSchema } from "@pena/contracts";

export function readDocumentSlug(pathname: string): string | null {
  const match = /^\/documents\/([^/]+)\/?$/.exec(pathname);

  if (!match?.[1]) {
    return null;
  }

  try {
    const parsedSlug = DocumentSlugSchema.safeParse(
      decodeURIComponent(match[1]),
    );
    return parsedSlug.success ? parsedSlug.data : null;
  } catch {
    return null;
  }
}
