import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import {
  FileAssetStore,
  MAX_ASSET_BYTES,
} from "./storage/file-asset-store.js";
import {
  PersistedDataError,
  type PenaStore,
} from "./storage/pena-store.js";
import { SqlitePenaStore } from "./storage/sqlite-pena-store.js";

const DOCUMENT_URL = "/api/docs/initial-spec";
const FEEDBACK_URL = `${DOCUMENT_URL}/feedback`;
const FEEDBACK_WAIT_URL = `${FEEDBACK_URL}/wait`;
const feedbackPayload = {
  comments: [
    {
      selectedText: "Current",
      comment: "Change this.",
      contextBefore: "",
      contextAfter: " draft",
    },
  ],
};

const apps = new Set<ReturnType<typeof buildApp>>();
const temporaryDirectories = new Set<string>();

function createApp(): ReturnType<typeof buildApp> {
  const app = buildApp(
    new SqlitePenaStore(":memory:"),
    createAssetStore(),
  );
  apps.add(app);
  return app;
}

function createAssetStore(): FileAssetStore {
  const directory = mkdtempSync(join(tmpdir(), "pena-assets-"));
  temporaryDirectories.add(directory);
  return new FileAssetStore(directory);
}

async function publishDocument(
  app: ReturnType<typeof buildApp>,
  url = DOCUMENT_URL,
  content = "Current draft",
  title = "Initial Specification",
) {
  const current = await app.inject({ method: "GET", url });
  const condition =
    current.statusCode === 200
      ? { "if-match": requiredEtag(current) }
      : { "if-none-match": "*" };

  return app.inject({
    method: "PUT",
    url,
    headers: { "content-type": "application/json", ...condition },
    payload: { title, content },
  });
}

async function createDocument(
  app: ReturnType<typeof buildApp>,
  url = DOCUMENT_URL,
  content = "Current draft",
  title = "Initial Specification",
) {
  return app.inject({
    method: "PUT",
    url,
    headers: {
      "content-type": "application/json",
      "if-none-match": "*",
    },
    payload: { title, content },
  });
}

async function documentEtag(
  app: ReturnType<typeof buildApp>,
  url = DOCUMENT_URL,
): Promise<string> {
  return requiredEtag(await app.inject({ method: "GET", url }));
}

function requiredEtag(response: { headers: Record<string, unknown> }): string {
  const etag = response.headers.etag;

  if (typeof etag !== "string") {
    throw new Error("Expected the document response to include an ETag.");
  }

  return etag;
}

function multipartImage(
  content: Buffer,
  {
    contentType = "application/octet-stream",
    fieldName = "file",
    filename = "image.png",
  }: {
    contentType?: string;
    fieldName?: string;
    filename?: string;
  } = {},
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = "pena-test-boundary";
  const prefix = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      "",
      "",
    ].join("\r\n"),
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);

  return {
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([prefix, content, suffix]),
  };
}

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();

  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("Pena API", () => {
  it("uploads, deduplicates, and serves an immutable image asset", async () => {
    const app = createApp();
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = multipartImage(image, {
      contentType: "text/plain",
      filename: "pixel.txt",
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...upload,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartImage(image),
    });

    expect(created.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    expect(created.json()).toEqual(duplicate.json());
    expect(created.json()).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{64}\.png$/),
      mediaType: "image/png",
      size: image.byteLength,
      url: expect.stringMatching(/^\/api\/assets\/[a-f0-9]{64}\.png$/),
    });

    const response = await app.inject({
      method: "GET",
      url: created.json().url,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["content-length"]).toBe(String(image.byteLength));
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.rawPayload).toEqual(image);
  });

  it("validates asset upload shape, type, and size", async () => {
    const app = createApp();
    const wrongRequestType = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: { "content-type": "image/png" },
      payload: Buffer.from("not-an-image"),
    });
    const wrongField = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartImage(Buffer.from("GIF89a"), {
        fieldName: "image",
        filename: "image.gif",
      }),
    });
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartImage(Buffer.from("<svg></svg>"), {
        contentType: "image/svg+xml",
        filename: "image.svg",
      }),
    });
    const oversizedImage = Buffer.alloc(MAX_ASSET_BYTES + 1);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
      oversizedImage,
    );
    const oversized = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartImage(oversizedImage),
    });

    expect(wrongRequestType.statusCode).toBe(415);
    expect(wrongField.statusCode).toBe(400);
    expect(unsupported.statusCode).toBe(415);
    expect(oversized.statusCode).toBe(413);
  });

  it("does not serve malformed, missing, or non-file asset paths", async () => {
    const app = createApp();

    expect(
      (await app.inject({ method: "GET", url: "/api/assets/not-an-id.png" }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/assets/${"a".repeat(64)}.png`,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("no longer serves workspace routes and rejects invalid slugs", async () => {
    const app = createApp();

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/workspaces/default/documents/initial-spec",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/api/workspaces" })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/api/docs/Invalid_Slug" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/collections/Invalid_Slug",
          payload: { name: "Renamed" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/api/docs?collection=Bad!" }))
        .statusCode,
    ).toBe(400);
  });

  it("creates, lists, renames, reparents, and deletes collections", async () => {
    const app = createApp();
    const emptyList = await app.inject({ method: "GET", url: "/api/collections" });
    expect(emptyList.json()).toEqual({ collections: [] });

    const created = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Product Notes" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      slug: "product-notes",
      name: "Product Notes",
      parentSlug: null,
    });

    const child = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Roadmaps", parentSlug: "product-notes" },
    });
    expect(child.statusCode).toBe(201);
    expect(child.json()).toMatchObject({
      slug: "roadmaps",
      parentSlug: "product-notes",
    });

    await publishDocument(app, "/api/docs/q3-roadmap", "Q3", "Q3 Roadmap");
    await app.inject({
      method: "POST",
      url: "/api/docs/q3-roadmap/move",
      headers: { "if-match": await documentEtag(app, "/api/docs/q3-roadmap") },
      payload: { collectionSlug: "roadmaps" },
    });

    const listed = await app.inject({ method: "GET", url: "/api/collections" });
    expect(listed.json()).toEqual({
      collections: [
        expect.objectContaining({
          slug: "product-notes",
          parentSlug: null,
          documentCount: 0,
          childCount: 1,
        }),
        expect.objectContaining({
          slug: "roadmaps",
          parentSlug: "product-notes",
          documentCount: 1,
          childCount: 0,
        }),
      ],
    });

    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/collections/product-notes",
      payload: { name: "Product Team" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      slug: "product-notes",
      name: "Product Team",
      parentSlug: null,
    });

    const reparented = await app.inject({
      method: "PATCH",
      url: "/api/collections/roadmaps",
      payload: { parentSlug: null },
    });
    expect(reparented.statusCode).toBe(200);
    expect(reparented.json()).toMatchObject({
      slug: "roadmaps",
      parentSlug: null,
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/collections/product-notes",
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: "/api/collections" })).json()
        .collections,
    ).toHaveLength(1);
  });

  it("rejects invalid collection changes", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Parent" },
    });
    await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Child", parentSlug: "parent" },
    });

    const cycle = await app.inject({
      method: "PATCH",
      url: "/api/collections/parent",
      payload: { parentSlug: "child" },
    });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().error).toContain("descendants");

    const selfParent = await app.inject({
      method: "PATCH",
      url: "/api/collections/parent",
      payload: { parentSlug: "parent" },
    });
    expect(selfParent.statusCode).toBe(409);

    const nonEmptyParent = await app.inject({
      method: "DELETE",
      url: "/api/collections/parent",
    });
    expect(nonEmptyParent.statusCode).toBe(409);

    await publishDocument(app, "/api/docs/child-doc");
    await app.inject({
      method: "POST",
      url: "/api/docs/child-doc/move",
      headers: { "if-match": await documentEtag(app, "/api/docs/child-doc") },
      payload: { collectionSlug: "child" },
    });
    const nonEmptyChild = await app.inject({
      method: "DELETE",
      url: "/api/collections/child",
    });
    expect(nonEmptyChild.statusCode).toBe(409);

    const missingParent = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Orphan", parentSlug: "nowhere" },
    });
    expect(missingParent.statusCode).toBe(404);

    const missingCollection = await app.inject({
      method: "PATCH",
      url: "/api/collections/nowhere",
      payload: { name: "Anything" },
    });
    expect(missingCollection.statusCode).toBe(404);

    const emptyUpdate = await app.inject({
      method: "PATCH",
      url: "/api/collections/parent",
      payload: {},
    });
    expect(emptyUpdate.statusCode).toBe(400);

    const invalidName = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "!!!" },
    });
    expect(invalidName.statusCode).toBe(400);

    const blankName = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "   " },
    });
    expect(blankName.statusCode).toBe(400);

    const duplicateName = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "parent" },
    });
    expect(duplicateName.statusCode).toBe(409);
  });

  it("keeps document slugs global and files a new document by collection", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Research" },
    });
    await publishDocument(app, DOCUMENT_URL, "Root copy");

    const duplicate = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: {
        "content-type": "application/json",
        "if-none-match": "*",
      },
      payload: {
        title: "Initial Specification",
        content: "Second copy",
        collectionSlug: "research",
      },
    });
    expect(duplicate.statusCode).toBe(412);

    const filed = await app.inject({
      method: "PUT",
      url: "/api/docs/research-notes",
      headers: {
        "content-type": "application/json",
        "if-none-match": "*",
      },
      payload: {
        title: "Research Notes",
        content: "Filed on create",
        collectionSlug: "research",
      },
    });
    expect(filed.statusCode).toBe(201);
    expect(filed.json()).toMatchObject({
      slug: "research-notes",
      collectionSlug: "research",
    });
    expect(
      (await app.inject({ method: "GET", url: "/api/docs/research-notes" }))
        .json(),
    ).toMatchObject({ collectionSlug: "research", content: "Filed on create" });
    expect(
      (await app.inject({ method: "GET", url: DOCUMENT_URL })).json(),
    ).toMatchObject({ collectionSlug: null, content: "Root copy" });

    const inCollection = await app.inject({
      method: "GET",
      url: "/api/docs?collection=research",
    });
    expect(inCollection.json().documents).toEqual([
      expect.objectContaining({ slug: "research-notes" }),
    ]);
    const atRoot = await app.inject({
      method: "GET",
      url: "/api/docs?collection=root",
    });
    expect(atRoot.json().documents).toEqual([
      expect.objectContaining({ slug: "initial-spec" }),
    ]);
    const everything = await app.inject({ method: "GET", url: "/api/docs" });
    expect(everything.json().documents).toHaveLength(2);

    const missingCollection = await app.inject({
      method: "PUT",
      url: "/api/docs/lost-notes",
      headers: {
        "content-type": "application/json",
        "if-none-match": "*",
      },
      payload: {
        title: "Lost Notes",
        content: "Nowhere",
        collectionSlug: "nowhere",
      },
    });
    expect(missingCollection.statusCode).toBe(404);
  });

  it("moves an active document into a collection and back to the root", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Research" },
    });
    await publishDocument(app);
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: feedbackPayload,
    });
    const beforeMove = await documentEtag(app);

    const response = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      headers: { "if-match": beforeMove },
      payload: { collectionSlug: "research" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      collectionSlug: "research",
      slug: "initial-spec",
    });
    expect(requiredEtag(response)).not.toBe(beforeMove);
    expect((await app.inject({ method: "GET", url: DOCUMENT_URL })).json())
      .toMatchObject({ collectionSlug: "research" });
    expect(
      (await app.inject({ method: "GET", url: FEEDBACK_URL })).json().batches,
    ).toHaveLength(1);

    const stale = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      headers: { "if-match": beforeMove },
      payload: { collectionSlug: null },
    });
    expect(stale.statusCode).toBe(412);

    const backToRoot = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      headers: { "if-match": await documentEtag(app) },
      payload: { collectionSlug: null },
    });
    expect(backToRoot.statusCode).toBe(200);
    expect(backToRoot.json()).toMatchObject({ collectionSlug: null });
    expect(
      (await app.inject({ method: "GET", url: "/api/docs?collection=root" }))
        .json().documents,
    ).toEqual([expect.objectContaining({ slug: "initial-spec" })]);
  });

  it("blocks moving archived documents and rejects bad destinations", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Research" },
    });
    await publishDocument(app);

    const unknown = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      headers: { "if-match": await documentEtag(app) },
      payload: { collectionSlug: "nowhere" },
    });
    expect(unknown.statusCode).toBe(404);

    const malformed = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      headers: { "if-match": await documentEtag(app) },
      payload: { collectionSlug: "Bad Slug" },
    });
    expect(malformed.statusCode).toBe(400);

    const missingField = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      headers: { "if-match": await documentEtag(app) },
      payload: {},
    });
    expect(missingField.statusCode).toBe(400);

    await app.inject({
      method: "PATCH",
      url: DOCUMENT_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: { status: "archived" },
    });
    const archived = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      headers: { "if-match": await documentEtag(app) },
      payload: { collectionSlug: "research" },
    });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error).toContain("Unarchive");
  });

  it("lists published documents by most recent update", async () => {
    const app = createApp();
    await publishDocument(app, "/api/docs/older-draft", "## Older draft");
    await publishDocument(app, "/api/docs/newer-draft", "## Newer draft");

    const response = await app.inject({ method: "GET", url: "/api/docs" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      documents: [
        expect.objectContaining({
          slug: "newer-draft",
          title: "Initial Specification",
          version: 1,
          excerpt: "",
        }),
        expect.objectContaining({ slug: "older-draft", version: 1 }),
      ],
    });
    expect(response.json().documents[0]).not.toHaveProperty("content");
  });

  it("archives, restores, and permanently deletes documents", async () => {
    const app = createApp();
    await publishDocument(app);

    const activeDelete = await app.inject({
      method: "DELETE",
      url: DOCUMENT_URL,
      headers: { "if-match": await documentEtag(app) },
    });
    expect(activeDelete.statusCode).toBe(409);

    const archiveResponse = await app.inject({
      method: "PATCH",
      url: DOCUMENT_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: { status: "archived" },
    });
    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json().archivedAt).toBeTruthy();

    const activeDocuments = await app.inject({
      method: "GET",
      url: "/api/docs",
    });
    const archivedDocuments = await app.inject({
      method: "GET",
      url: "/api/docs?status=archived",
    });
    expect(activeDocuments.json()).toEqual({ documents: [] });
    expect(archivedDocuments.json().documents).toHaveLength(1);

    const restoreResponse = await app.inject({
      method: "PATCH",
      url: DOCUMENT_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: { status: "active" },
    });
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json().archivedAt).toBeNull();

    await app.inject({
      method: "PATCH",
      url: DOCUMENT_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: { status: "archived" },
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: DOCUMENT_URL,
      headers: { "if-match": await documentEtag(app) },
    });
    expect(deleteResponse.statusCode).toBe(204);

    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });
    expect(documentResponse.statusCode).toBe(404);
  });

  it("lists the global archive and filters it by collection", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "Research" },
    });
    const rootUrl = "/api/docs/root-draft";
    const researchUrl = "/api/docs/research-draft";
    await publishDocument(app, rootUrl, "Root copy");
    await publishDocument(app, researchUrl, "Research copy");
    await app.inject({
      method: "POST",
      url: `${researchUrl}/move`,
      headers: { "if-match": await documentEtag(app, researchUrl) },
      payload: { collectionSlug: "research" },
    });
    await app.inject({
      method: "PATCH",
      url: rootUrl,
      headers: { "if-match": await documentEtag(app, rootUrl) },
      payload: { status: "archived" },
    });
    await app.inject({
      method: "PATCH",
      url: researchUrl,
      headers: { "if-match": await documentEtag(app, researchUrl) },
      payload: { status: "archived" },
    });

    const allArchive = await app.inject({ method: "GET", url: "/api/archive" });
    expect(allArchive.statusCode).toBe(200);
    expect(allArchive.json().documents).toEqual([
      expect.objectContaining({
        collectionSlug: "research",
        slug: "research-draft",
      }),
      expect.objectContaining({ collectionSlug: null, slug: "root-draft" }),
    ]);

    const researchArchive = await app.inject({
      method: "GET",
      url: "/api/archive?collection=research",
    });
    expect(researchArchive.statusCode).toBe(200);
    expect(researchArchive.json().documents).toEqual([
      expect.objectContaining({
        collectionSlug: "research",
        slug: "research-draft",
      }),
    ]);

    const missingArchive = await app.inject({
      method: "GET",
      url: "/api/archive?collection=nowhere",
    });
    expect(missingArchive.statusCode).toBe(404);
  });

  it("rejects an invalid document list status", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/docs?status=deleted",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("active");
  });

  it("creates without a preliminary read and returns document metadata", async () => {
    const app = createApp();

    const publishResponse = await createDocument(
      app,
      DOCUMENT_URL,
      "Hello Pena.",
    );

    expect(publishResponse.statusCode).toBe(201);
    expect(requiredEtag(publishResponse)).toMatch(/^"pena-.+"$/);
    expect(publishResponse.json()).toEqual({
      slug: "initial-spec",
      collectionSlug: null,
      title: "Initial Specification",
      version: 1,
      updatedAt: expect.any(String),
      archivedAt: null,
    });

    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });

    expect(documentResponse.statusCode).toBe(200);
    expect(documentResponse.json()).toMatchObject({
      slug: "initial-spec",
      title: "Initial Specification",
      content: "Hello Pena.",
      version: 1,
    });
  });

  it("requires an explicit title and content for every publication", async () => {
    const app = createApp();
    const missingTitle = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: {
        "content-type": "application/json",
        "if-none-match": "*",
      },
      payload: { content: "# Untitled" },
    });
    const blankTitle = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: {
        "content-type": "application/json",
        "if-none-match": "*",
      },
      payload: { title: "   ", content: "# Untitled" },
    });

    expect(missingTitle.statusCode).toBe(400);
    expect(blankTitle.statusCode).toBe(400);
    expect(missingTitle.json().error).toContain("nonblank title");
    expect(
      (await app.inject({ method: "GET", url: DOCUMENT_URL })).statusCode,
    ).toBe(404);
  });

  it("rejects Markdown that repeats the explicit title as a leading H1", async () => {
    const app = createApp();
    const response = await createDocument(
      app,
      DOCUMENT_URL,
      "# Initial Specification\n\nHello Pena.",
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain(
      "must not repeat the document title as a leading H1",
    );
    expect(
      (await app.inject({ method: "GET", url: DOCUMENT_URL })).statusCode,
    ).toBe(404);
  });

  it("stores multiple comments in one feedback batch", async () => {
    const app = createApp();
    const published = await publishDocument(
      app,
      DOCUMENT_URL,
      "Alpha beta gamma delta.",
    );
    const etag = requiredEtag(published);

    const submitResponse = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
      payload: {
        comments: [
          {
            selectedText: "Alpha",
            comment: "Explain this term.",
            contextBefore: "",
            contextAfter: " beta gamma",
          },
          {
            selectedText: "delta",
            comment: "Remove this word.",
            contextBefore: "beta gamma ",
            contextAfter: ".",
          },
        ],
      },
    });

    expect(submitResponse.statusCode).toBe(201);
    expect(requiredEtag(submitResponse)).toBe(etag);
    expect(submitResponse.json()).toEqual({
      id: 1,
      submittedAt: expect.any(String),
    });

    const feedbackResponse = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
    });

    const feedback = feedbackResponse.json();
    expect(requiredEtag(feedbackResponse)).toBe(etag);
    expect(feedback.latestBatchId).toBe(1);
    expect(feedback.batches).toHaveLength(1);
    expect(feedback.batches[0].id).toBe(1);
    expect(feedback.batches[0].comments).toHaveLength(2);
  });

  it("stores a submission-level instruction without an inline comment", async () => {
    const app = createApp();
    const published = await publishDocument(app);
    const etag = requiredEtag(published);

    const submitResponse = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
      payload: {
        instruction: "Keep the public API unchanged.",
        comments: [],
      },
    });

    expect(submitResponse.statusCode).toBe(201);
    expect(submitResponse.json()).toEqual({
      id: 1,
      submittedAt: expect.any(String),
    });

    const feedbackResponse = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
    });

    expect(feedbackResponse.json().batches).toEqual([
      {
        id: 1,
        submittedAt: expect.any(String),
        instruction: "Keep the public API unchanged.",
        comments: [],
      },
    ]);
  });

  it("returns committed feedback immediately after the supplied cursor", async () => {
    const app = createApp();
    const published = await publishDocument(app);
    const etag = requiredEtag(published);
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
      payload: feedbackPayload,
    });
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
      payload: feedbackPayload,
    });

    const response = await app.inject({
      method: "GET",
      url: `${FEEDBACK_WAIT_URL}?after=1&timeout=20`,
    });

    expect(response.statusCode).toBe(200);
    expect(requiredEtag(response)).toBe(etag);
    expect(response.json()).toEqual({
      documentSlug: "initial-spec",
      documentVersion: 1,
      latestBatchId: 2,
      batches: [{ id: 2, submittedAt: expect.any(String) }],
    });
  });

  it("holds a feedback wait until matching feedback is committed", async () => {
    const app = createApp();
    const published = await publishDocument(app);
    const etag = requiredEtag(published);
    const waiting = app.inject({
      method: "GET",
      url: `${FEEDBACK_WAIT_URL}?after=0&timeout=1000`,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const submitted = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
      payload: feedbackPayload,
    });
    const response = await waiting;

    expect(submitted.statusCode).toBe(201);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      latestBatchId: submitted.json().id,
      batches: [{ id: submitted.json().id }],
    });
  });

  it("times out a feedback wait without emitting an event", async () => {
    const app = createApp();
    await publishDocument(app);

    const response = await app.inject({
      method: "GET",
      url: `${FEEDBACK_WAIT_URL}?after=0&timeout=5`,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("isolates feedback waits by document", async () => {
    const app = createApp();
    const articleUrl = "/api/docs/article-draft";
    const articleWaitUrl = `${articleUrl}/feedback/wait`;
    await publishDocument(app);
    await publishDocument(app, articleUrl, "Article draft");
    const defaultWait = app.inject({
      method: "GET",
      url: `${FEEDBACK_WAIT_URL}?after=0&timeout=20`,
    });
    const articleWait = app.inject({
      method: "GET",
      url: `${articleWaitUrl}?after=0&timeout=1000`,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    await app.inject({
      method: "POST",
      url: `${articleUrl}/feedback`,
      headers: { "if-match": await documentEtag(app, articleUrl) },
      payload: feedbackPayload,
    });

    expect((await articleWait).statusCode).toBe(200);
    expect((await defaultWait).statusCode).toBe(204);
  });

  it("validates feedback wait cursors and timeouts", async () => {
    const app = createApp();
    await publishDocument(app);

    const invalidCursor = await app.inject({
      method: "GET",
      url: `${FEEDBACK_WAIT_URL}?after=-1&timeout=20`,
    });
    const invalidTimeout = await app.inject({
      method: "GET",
      url: `${FEEDBACK_WAIT_URL}?after=0&timeout=30001`,
    });

    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json().error).toContain("non-negative integer");
    expect(invalidTimeout.statusCode).toBe(400);
    expect(invalidTimeout.json().error).toContain("1 to 30000");
  });

  it("releases a pending feedback wait during server shutdown", async () => {
    const app = createApp();
    await publishDocument(app);
    const waiting = app.inject({
      method: "GET",
      url: `${FEEDBACK_WAIT_URL}?after=0&timeout=30000`,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const closing = app.close();
    const response = await waiting;
    await closing;
    apps.delete(app);

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain("shutting down");
  });

  it("rejects a feedback read when the retained document ETag is stale", async () => {
    const app = createApp();
    const first = await publishDocument(app);
    await publishDocument(app, DOCUMENT_URL, "Replacement draft");

    const response = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
      headers: { "if-match": requiredEtag(first) },
    });

    expect(response.statusCode).toBe(412);
    expect(response.json()).toEqual({
      error: "The document changed after it was read.",
      currentVersion: 2,
    });
  });

  it("rejects republishing when newer feedback arrived after it was read", async () => {
    const app = createApp();
    const published = await publishDocument(app);
    const etag = requiredEtag(published);

    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
      payload: feedbackPayload,
    });
    const firstRead = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
    });
    const firstLatestBatchId = firstRead.json().latestBatchId;

    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
      payload: feedbackPayload,
    });

    const staleFeedbackPublish = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: {
        "content-type": "application/json",
        "if-match": etag,
        "if-feedback-match": String(firstLatestBatchId),
      },
      payload: {
        title: "Initial Specification",
        content: "Revision that missed newer feedback",
      },
    });

    expect(staleFeedbackPublish.statusCode).toBe(412);
    expect(staleFeedbackPublish.json()).toEqual({
      error: "New feedback was submitted after it was read.",
      currentVersion: 1,
      latestBatchId: 2,
    });
    expect((await app.inject({ method: "GET", url: DOCUMENT_URL })).json())
      .toMatchObject({ content: "Current draft", version: 1 });

    const latestFeedback = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
      headers: { "if-match": etag },
    });
    const revised = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: {
        "content-type": "application/json",
        "if-match": etag,
        "if-feedback-match": String(latestFeedback.json().latestBatchId),
      },
      payload: {
        title: "Initial Specification",
        content: "Revision including all feedback",
      },
    });

    expect(revised.statusCode).toBe(200);
    expect(revised.json().version).toBe(2);
    expect(requiredEtag(revised)).not.toBe(etag);
  });

  it("keeps feedback when an identical title and content are published again", async () => {
    const app = createApp();
    const firstPublish = await publishDocument(app);
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: feedbackPayload,
    });

    const repeatedPublish = await publishDocument(app);
    const feedbackResponse = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
    });

    expect(repeatedPublish.json().updatedAt).toBe(
      firstPublish.json().updatedAt,
    );
    expect(repeatedPublish.json().version).toBe(1);
    expect(feedbackResponse.json().batches).toHaveLength(1);
  });

  it("increments the document version when title or content changes", async () => {
    const app = createApp();

    const firstPublish = await publishDocument(app);
    const changedPublish = await publishDocument(
      app,
      DOCUMENT_URL,
      "Replacement draft",
    );
    const repeatedPublish = await publishDocument(
      app,
      DOCUMENT_URL,
      "Replacement draft",
    );
    const renamedPublish = await publishDocument(
      app,
      DOCUMENT_URL,
      "Replacement draft",
      "Architecture Specification",
    );

    expect(firstPublish.json().version).toBe(1);
    expect(changedPublish.json().version).toBe(2);
    expect(repeatedPublish.json().version).toBe(2);
    expect(renamedPublish.json()).toMatchObject({
      title: "Architecture Specification",
      version: 3,
    });
    expect(requiredEtag(renamedPublish)).not.toBe(
      requiredEtag(repeatedPublish),
    );
  });

  it("requires current HTTP preconditions and rejects stale publication", async () => {
    const app = createApp();
    const missingPrecondition = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: { "content-type": "application/json" },
      payload: { title: "Initial Specification", content: "First" },
    });
    expect(missingPrecondition.statusCode).toBe(428);

    const created = await createDocument(app, DOCUMENT_URL, "First");
    const staleEtag = requiredEtag(created);
    const duplicateCreate = await createDocument(
      app,
      DOCUMENT_URL,
      "Unexpected replacement",
    );
    expect(duplicateCreate.statusCode).toBe(412);
    expect(duplicateCreate.json()).toEqual({
      error: "The document changed after it was read.",
      currentVersion: 1,
    });

    const updated = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: {
        "content-type": "application/json",
        "if-match": staleEtag,
      },
      payload: { title: "Initial Specification", content: "Second" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      slug: "initial-spec",
      collectionSlug: null,
      title: "Initial Specification",
      version: 2,
      updatedAt: expect.any(String),
      archivedAt: null,
    });
    expect(requiredEtag(updated)).not.toBe(staleEtag);

    const stale = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: {
        "content-type": "application/json",
        "if-match": staleEtag,
      },
      payload: {
        title: "Initial Specification",
        content: "Stale replacement",
      },
    });

    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toEqual({
      error: "The document changed after it was read.",
      currentVersion: 2,
    });
    expect((await app.inject({ method: "GET", url: DOCUMENT_URL })).json())
      .toMatchObject({ content: "Second", version: 2 });
  });

  it("lists, reads, compares externally, and restores immutable versions", async () => {
    const app = createApp();
    await publishDocument(app, DOCUMENT_URL, "Version one");
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: feedbackPayload,
    });
    await publishDocument(app, DOCUMENT_URL, "Version two");

    const history = await app.inject({
      method: "GET",
      url: `${DOCUMENT_URL}/versions`,
    });
    const firstVersion = await app.inject({
      method: "GET",
      url: `${DOCUMENT_URL}/versions/1`,
    });

    expect(history.json().versions.map(({ version }: { version: number }) => version))
      .toEqual([2, 1]);
    expect(firstVersion.json()).toMatchObject({
      version: 1,
      content: "Version one",
    });

    const restored = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/versions/1/restore`,
      headers: { "if-match": await documentEtag(app) },
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      version: 3,
      content: "Version one",
    });
    expect((await app.inject({ method: "GET", url: FEEDBACK_URL })).json())
      .toEqual({ latestBatchId: null, batches: [] });
  });

  it("isolates documents and feedback by slug", async () => {
    const app = createApp();
    const articleUrl = "/api/docs/article-draft";
    const articleFeedbackUrl = `${articleUrl}/feedback`;

    await publishDocument(app);
    await publishDocument(app, articleUrl, "Article draft");
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: feedbackPayload,
    });
    await app.inject({
      method: "POST",
      url: articleFeedbackUrl,
      headers: { "if-match": await documentEtag(app, articleUrl) },
      payload: feedbackPayload,
    });

    await publishDocument(app, DOCUMENT_URL, "Replacement draft");

    const replacedFeedback = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
    });
    const articleFeedback = await app.inject({
      method: "GET",
      url: articleFeedbackUrl,
    });

    expect(replacedFeedback.json()).toEqual({
      latestBatchId: null,
      batches: [],
    });
    expect(articleFeedback.json().batches).toHaveLength(1);
  });

  it("keeps multiple submissions until that document is replaced", async () => {
    const app = createApp();
    await publishDocument(app);

    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: feedbackPayload,
    });
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": await documentEtag(app) },
      payload: feedbackPayload,
    });

    const response = await app.inject({ method: "GET", url: FEEDBACK_URL });
    expect(response.json().batches).toHaveLength(2);
  });

  it("rejects feedback submitted against a stale document state", async () => {
    const app = createApp();
    const first = await publishDocument(app);
    await publishDocument(app, DOCUMENT_URL, "Replacement draft");

    const response = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      headers: { "if-match": requiredEtag(first) },
      payload: feedbackPayload,
    });

    expect(response.statusCode).toBe(412);
    expect((await app.inject({ method: "GET", url: FEEDBACK_URL })).json())
      .toEqual({ latestBatchId: null, batches: [] });
  });

  it("rejects invalid slugs and invalid feedback", async () => {
    const app = createApp();

    const invalidSlugResponse = await publishDocument(
      app,
      "/api/docs/Invalid_Slug",
    );
    expect(invalidSlugResponse.statusCode).toBe(400);

    await publishDocument(app);
    const invalidFeedbackResponse = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: { comments: [] },
    });
    expect(invalidFeedbackResponse.statusCode).toBe(400);
  });

  it("rejects malformed feedback preconditions", async () => {
    const app = createApp();
    const published = await publishDocument(app);
    const etag = requiredEtag(published);

    const invalidRead = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
      headers: { "if-match": 'W/"pena-weak"' },
    });
    const invalidPublish = await app.inject({
      method: "PUT",
      url: DOCUMENT_URL,
      headers: {
        "content-type": "application/json",
        "if-match": etag,
        "if-feedback-match": "0",
      },
      payload: {
        title: "Initial Specification",
        content: "Replacement draft",
      },
    });

    expect(invalidRead.statusCode).toBe(400);
    expect(invalidPublish.statusCode).toBe(400);
    expect(invalidPublish.json()).toEqual({
      error: "If-Feedback-Match must contain one positive feedback batch ID.",
    });
  });

  it("requires a precondition before feedback can target a missing document", async () => {
    const app = createApp();

    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });
    const feedbackResponse = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
    });
    const submitResponse = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: feedbackPayload,
    });

    expect(documentResponse.statusCode).toBe(404);
    expect(feedbackResponse.statusCode).toBe(404);
    expect(submitResponse.statusCode).toBe(428);
  });

  it("returns HTTP 500 for invalid persisted feedback", async () => {
    const store: PenaStore = {
      listCollections() {
        throw new Error("Not used in this test.");
      },
      createCollection() {
        throw new Error("Not used in this test.");
      },
      updateCollection() {
        throw new Error("Not used in this test.");
      },
      deleteCollection() {
        throw new Error("Not used in this test.");
      },
      publishDocument() {
        throw new Error("Not used in this test.");
      },
      getDocument() {
        throw new Error("Not used in this test.");
      },
      listDocumentVersions() {
        throw new Error("Not used in this test.");
      },
      getDocumentVersion() {
        throw new Error("Not used in this test.");
      },
      restoreDocumentVersion() {
        throw new Error("Not used in this test.");
      },
      getDocumentResource() {
        return {
          etag: '"pena-test"',
          value: {
            slug: "initial-spec",
            collectionSlug: null,
            title: "Initial Specification",
            content: "Current draft",
            version: 1,
            updatedAt: "2026-07-26T00:00:00.000Z",
            archivedAt: null,
          },
        };
      },
      listDocuments() {
        throw new Error("Not used in this test.");
      },
      listArchivedDocuments() {
        throw new Error("Not used in this test.");
      },
      moveDocument() {
        throw new Error("Not used in this test.");
      },
      archiveDocument() {
        throw new Error("Not used in this test.");
      },
      unarchiveDocument() {
        throw new Error("Not used in this test.");
      },
      deleteArchivedDocument() {
        throw new Error("Not used in this test.");
      },
      addFeedback() {
        throw new Error("Not used in this test.");
      },
      getFeedback() {
        throw new PersistedDataError("Invalid persisted feedback.");
      },
      listFeedbackReceiptsAfter() {
        throw new Error("Not used in this test.");
      },
      close() {},
    };
    const app = buildApp(store, createAssetStore());
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "The document feedback contains invalid persisted data.",
    });
  });

  it("publishes valid decision blocks and preserves their Markdown", async () => {
    const app = createApp();
    const content = [
      "Review the proposed change.",
      "",
      ':::pena-decision{#add-request-cache choice-a="Apply" choice-b="Skip"}',
      "## Add request caching",
      "",
      "Cache repeated reads for five minutes.",
      ":::",
    ].join("\n");

    const publishResponse = await publishDocument(
      app,
      DOCUMENT_URL,
      content,
    );
    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });

    expect(publishResponse.statusCode).toBe(201);
    expect(documentResponse.json().content).toBe(content);
  });

  it("accepts ten uniquely identified decision blocks", async () => {
    const app = createApp();
    const content = Array.from(
      { length: 10 },
      (_, index) =>
        [
          `:::pena-decision{#decision-${index + 1} choice-a="Apply" choice-b="Skip"}`,
          `## Decision ${index + 1}`,
          "Review this change.",
          ":::",
        ].join("\n"),
    ).join("\n\n");

    const response = await publishDocument(app, DOCUMENT_URL, content);

    expect(response.statusCode).toBe(201);
  });

  it.each([
    {
      name: "malformed attributes",
      content:
        ':::pena-decision{#cache choice-a="Apply"}\nReview caching.\n:::',
    },
    {
      name: "duplicate IDs",
      content: [
        ':::pena-decision{#cache choice-a="Apply" choice-b="Skip"}',
        "First.",
        ":::",
        ':::pena-decision{#cache choice-a="Keep" choice-b="Remove"}',
        "Second.",
        ":::",
      ].join("\n"),
    },
    {
      name: "nested blocks",
      content: [
        ':::pena-decision{#outer choice-a="Apply" choice-b="Skip"}',
        "Outer.",
        ':::pena-decision{#inner choice-a="Keep" choice-b="Remove"}',
        "Inner.",
        ":::",
        ":::",
      ].join("\n"),
    },
    {
      name: "non-top-level blocks",
      content: [
        '- Item',
        '  :::pena-decision{#nested choice-a="Apply" choice-b="Skip"}',
        "  Nested.",
        "  :::",
      ].join("\n"),
    },
    {
      name: "blank choices",
      content:
        ':::pena-decision{#cache choice-a=" " choice-b="Skip"}\nReview caching.\n:::',
    },
    {
      name: "identical choices",
      content:
        ':::pena-decision{#cache choice-a="Apply" choice-b="Apply"}\nReview caching.\n:::',
    },
    {
      name: "missing closing marker",
      content:
        ':::pena-decision{#cache choice-a="Apply" choice-b="Skip"}\nReview caching.',
    },
  ])("rejects $name without replacing the current document", async ({ content }) => {
    const app = createApp();
    await publishDocument(app, DOCUMENT_URL, "Previous document");

    const response = await publishDocument(app, DOCUMENT_URL, content);
    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/^Invalid decision block on line /);
    expect(documentResponse.json().content).toBe("Previous document");
  });

  it("ignores decision examples inside fenced code blocks", async () => {
    const app = createApp();
    const content = [
      "```markdown",
      ':::pena-decision{#example choice-a="Apply" choice-b="Skip"}',
      "Example body.",
      ":::",
      "```",
    ].join("\n");

    const response = await publishDocument(app, DOCUMENT_URL, content);

    expect(response.statusCode).toBe(201);
  });
});
