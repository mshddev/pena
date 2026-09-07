import type {
  DocumentMetadata,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionSummary,
  PenaDocument,
} from "@pena/contracts";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  documentPath,
  requireEtag,
  responseError,
  type ApiResponse,
  type PenaClient,
} from "../client.js";
import { errorMessage, usageError } from "../errors.js";
import {
  findMarkdownImages,
  isLocalImageDestination,
  rewriteMarkdownImages,
} from "../markdown-images.js";
import { uploadImageFile } from "./asset.js";
import {
  booleanOption,
  describeCollection,
  documentUrl,
  parseCollectionTarget,
  parseDocumentSlug,
  parseDocumentTitle,
  parseEtag,
  parsePositiveInteger,
  positional,
  stringOption,
  type CommandContext,
  type CommandHandler,
  type CommandResult,
} from "./context.js";

interface CurrentDocument {
  document: PenaDocument;
  etag: string;
}

async function getDocument(
  client: PenaClient,
  slug: string,
): Promise<CurrentDocument> {
  const response = await client.expect("GET", documentPath(slug));

  return {
    document: response.body as PenaDocument,
    etag: requireEtag(response),
  };
}

function documentResult(
  context: CommandContext,
  response: ApiResponse,
  headline: string,
): CommandResult {
  const document = response.body as DocumentMetadata;
  const etag = requireEtag(response);

  return {
    data: { ...document, etag },
    text: [
      `${headline} v${document.version} in ${describeCollection(document.collectionSlug)}`,
      `ETag: ${etag}`,
      `URL: ${documentUrl(context.baseUrl, document.slug)}`,
    ].join("\n"),
  };
}

function describeDocumentLine(document: DocumentSummary): string {
  return `${document.slug}\tv${document.version}\t${describeCollection(document.collectionSlug)}\t${document.title}`;
}

export const docList: CommandHandler = async (context) => {
  const collectionOption = stringOption(context, "collection");
  const query: Record<string, string> = {};

  if (collectionOption !== undefined) {
    parseCollectionTarget(collectionOption);
    query.collection = collectionOption;
  }

  const response = await context.client.expect(
    "GET",
    booleanOption(context, "archived") ? "/api/archive" : "/api/docs",
    { query },
  );
  const body = response.body as { documents: DocumentSummary[] };
  const lines = body.documents.map(describeDocumentLine);

  return {
    data: body,
    text: lines.length > 0 ? lines.join("\n") : "No documents.",
  };
};

export const docShow: CommandHandler = async (context) => {
  const slug = parseDocumentSlug(positional(context, 0));
  const versionOption = stringOption(context, "version");

  if (versionOption !== undefined) {
    const version = parsePositiveInteger(versionOption, "--version");
    const response = await context.client.expect(
      "GET",
      documentPath(slug, `/versions/${version}`),
    );
    const document = response.body as DocumentVersion;

    return {
      data: document,
      text: [
        `Title: ${document.title}`,
        `Slug: ${document.slug}`,
        `Version: ${document.version}`,
        `Collection: ${describeCollection(document.collectionSlug)}`,
        `Updated: ${document.updatedAt}`,
        "",
        document.content,
      ].join("\n"),
    };
  }

  const { document, etag } = await getDocument(context.client, slug);

  return {
    data: { ...document, etag },
    text: [
      `Title: ${document.title}`,
      `Slug: ${document.slug}`,
      `Version: ${document.version}`,
      `Collection: ${describeCollection(document.collectionSlug)}`,
      `Archived: ${document.archivedAt ?? "no"}`,
      `Updated: ${document.updatedAt}`,
      `ETag: ${etag}`,
      `URL: ${documentUrl(context.baseUrl, document.slug)}`,
      "",
      document.content,
    ].join("\n"),
  };
};

/** Ported from resources/skills/pena/scripts/publish-document.mjs. */
export function hasLeadingH1(content: string): boolean {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let index = 0;

  if (lines[0]?.trim() === "---") {
    index = 1;

    while (index < lines.length && lines[index]?.trim() !== "---") {
      index += 1;
    }

    if (index === lines.length) {
      return false;
    }

    index += 1;
  }

  while (index < lines.length && lines[index]?.trim() === "") {
    index += 1;
  }

  const firstLine = lines[index] ?? "";
  const secondLine = lines[index + 1] ?? "";

  return (
    /^ {0,3}#[\t ]+\S/.test(firstLine) ||
    (firstLine.trim().length > 0 && /^ {0,3}=+[\t ]*$/.test(secondLine))
  );
}

export interface UploadedImage {
  path: string;
  url: string;
}

function resolveImagePath(directory: string, destination: string): string {
  let path = destination.trim();

  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw destination when it is not percent-encoded.
  }

  return resolve(directory, path);
}

/**
 * Uploads every local image the Markdown references and returns a staged copy
 * with the destinations rewritten to asset URLs. The source is left untouched.
 */
export async function stageImages(
  client: PenaClient,
  content: string,
  directory: string,
): Promise<{ content: string; uploadedImages: UploadedImage[] }> {
  const uploads = new Map<string, string>();
  const uploadedImages: UploadedImage[] = [];

  for (const reference of findMarkdownImages(content)) {
    if (!isLocalImageDestination(reference.destination)) {
      continue;
    }

    const path = resolveImagePath(directory, reference.destination);

    if (uploads.has(path)) {
      continue;
    }

    const asset = await uploadImageFile(client, path);
    uploads.set(path, asset.url);
    uploadedImages.push({ path, url: asset.url });
  }

  const staged = rewriteMarkdownImages(content, (destination) =>
    isLocalImageDestination(destination)
      ? (uploads.get(resolveImagePath(directory, destination)) ?? null)
      : null,
  );

  return { content: staged, uploadedImages };
}

async function readMarkdownFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw usageError(
      `Could not read the Markdown file "${path}": ${errorMessage(error)}`,
    );
  }
}

export const docPublish: CommandHandler = async (context) => {
  const filePath = resolve(context.io.cwd, positional(context, 0));
  const slugOption = stringOption(context, "slug");

  if (slugOption === undefined) {
    throw usageError("Missing --slug <slug>.");
  }

  const slug = parseDocumentSlug(slugOption);
  const titleOption = stringOption(context, "title");

  if (titleOption === undefined) {
    throw usageError("Missing --title <title>.");
  }

  const title = parseDocumentTitle(titleOption);
  const collectionOption = stringOption(context, "collection");
  const root = booleanOption(context, "root");

  if (collectionOption !== undefined && root) {
    throw usageError("Pass either --collection or --root, not both.");
  }

  // `--collection root` and `--root` both file the document at the root.
  const collectionSlug =
    collectionOption === undefined
      ? root
        ? null
        : undefined
      : parseCollectionTarget(collectionOption);
  const etagOption = stringOption(context, "etag");
  const create = booleanOption(context, "create");

  if (create && etagOption !== undefined) {
    throw usageError("Pass either --create or --etag, not both.");
  }

  const feedbackMatchOption = stringOption(context, "feedback-match");
  const feedbackMatch =
    feedbackMatchOption === undefined
      ? undefined
      : parsePositiveInteger(feedbackMatchOption, "--feedback-match");
  const content = await readMarkdownFile(filePath);

  if (hasLeadingH1(content)) {
    throw usageError(
      "The Markdown body must not repeat the document title as a leading H1.",
    );
  }

  const staged = booleanOption(context, "no-images")
    ? { content, uploadedImages: [] as UploadedImage[] }
    : await stageImages(context.client, content, dirname(filePath));
  const headers: Record<string, string> = {};

  if (create) {
    headers["if-none-match"] = "*";
  } else if (etagOption !== undefined) {
    headers["if-match"] = parseEtag(etagOption);
  } else {
    const current = await context.client.request("GET", documentPath(slug));

    if (current.status === 404) {
      headers["if-none-match"] = "*";
    } else if (current.ok) {
      headers["if-match"] = requireEtag(current);
    } else {
      throw responseError(current);
    }
  }

  if (feedbackMatch !== undefined) {
    headers["if-feedback-match"] = String(feedbackMatch);
  }

  const response = await context.client.expect("PUT", documentPath(slug), {
    headers,
    json: {
      title,
      content: staged.content,
      // Omitting collectionSlug leaves an existing document where it is.
      ...(collectionSlug !== undefined ? { collectionSlug } : {}),
    },
  });
  const document = response.body as DocumentMetadata;
  const etag = requireEtag(response);
  const created = response.status === 201;
  const url = documentUrl(context.baseUrl, document.slug);

  return {
    data: {
      slug: document.slug,
      title: document.title,
      version: document.version,
      collectionSlug: document.collectionSlug,
      archivedAt: document.archivedAt,
      etag,
      url,
      created,
      uploadedImages: staged.uploadedImages,
    },
    text: [
      `${created ? "Created" : "Published"} "${document.title}" v${document.version} in ${describeCollection(document.collectionSlug)}`,
      `ETag: ${etag}`,
      `URL: ${url}`,
      ...staged.uploadedImages.map(
        (image) => `Uploaded ${image.path} -> ${image.url}`,
      ),
    ].join("\n"),
  };
};

export const docRename: CommandHandler = async (context) => {
  const slug = parseDocumentSlug(positional(context, 0));
  const title = parseDocumentTitle(positional(context, 1));
  const current = await getDocument(context.client, slug);
  const response = await context.client.expect("PUT", documentPath(slug), {
    headers: { "if-match": current.etag },
    json: { title, content: current.document.content },
  });

  return documentResult(context, response, `Renamed ${slug} to "${title}"`);
};

export const docMove: CommandHandler = async (context) => {
  const slug = parseDocumentSlug(positional(context, 0));
  const toOption = stringOption(context, "to");

  if (toOption === undefined) {
    throw usageError("Missing --to <collection-slug|root>.");
  }

  const collectionSlug = parseCollectionTarget(toOption);
  const current = await getDocument(context.client, slug);
  const response = await context.client.expect(
    "POST",
    documentPath(slug, "/move"),
    {
      headers: { "if-match": current.etag },
      json: { collectionSlug },
    },
  );

  return documentResult(context, response, `Moved ${slug}`);
};

async function setDocumentStatus(
  context: CommandContext,
  status: "archived" | "active",
): Promise<CommandResult> {
  const slug = parseDocumentSlug(positional(context, 0));
  const current = await getDocument(context.client, slug);
  const response = await context.client.expect("PATCH", documentPath(slug), {
    headers: { "if-match": current.etag },
    json: { status },
  });

  return documentResult(
    context,
    response,
    `${status === "archived" ? "Archived" : "Unarchived"} ${slug}`,
  );
}

export const docArchive: CommandHandler = (context) =>
  setDocumentStatus(context, "archived");

export const docUnarchive: CommandHandler = (context) =>
  setDocumentStatus(context, "active");

export const docVersions: CommandHandler = async (context) => {
  const slug = parseDocumentSlug(positional(context, 0));
  const response = await context.client.expect(
    "GET",
    documentPath(slug, "/versions"),
  );
  const body = response.body as { versions: DocumentVersionSummary[] };
  const lines = body.versions.map(
    (version) =>
      `v${version.version}\t${version.updatedAt}\t${describeCollection(version.collectionSlug)}\t${version.title}`,
  );

  return {
    data: body,
    text: lines.length > 0 ? lines.join("\n") : "No versions.",
  };
};

export const docRestore: CommandHandler = async (context) => {
  const slug = parseDocumentSlug(positional(context, 0));
  const version = parsePositiveInteger(positional(context, 1), "<version>");
  const current = await getDocument(context.client, slug);
  const response = await context.client.expect(
    "POST",
    documentPath(slug, `/versions/${version}/restore`),
    { headers: { "if-match": current.etag } },
  );

  return documentResult(
    context,
    response,
    `Restored ${slug} from v${version}; now`,
  );
};
