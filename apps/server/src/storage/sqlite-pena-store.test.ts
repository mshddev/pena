import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  CollectionCycleError,
  CollectionNameInvalidError,
  CollectionNameConflictError,
  CollectionNotEmptyError,
  CollectionNotFoundError,
  CollectionSlugConflictError,
  DocumentArchivedError,
  DocumentNotArchivedError,
  DocumentNotFoundError,
  DocumentSlugConflictMigrationError,
  PersistedDataError,
  UnsupportedSchemaVersionError,
  type DocumentPublishOptions,
} from "./pena-store.js";
import { SqlitePenaStore } from "./sqlite-pena-store.js";

const feedbackSubmission = {
  comments: [
    {
      selectedText: "Current",
      comment: "Change this.",
      contextBefore: "",
      contextAfter: " draft",
    },
  ],
};

const stores = new Set<SqlitePenaStore>();
const temporaryDirectories = new Set<string>();

function createStore(
  filename = ":memory:",
  clock?: () => Date,
): SqlitePenaStore {
  const store = new SqlitePenaStore(filename, { clock });
  stores.add(store);
  return store;
}

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "pena-storage-"));
  temporaryDirectories.add(directory);
  return join(directory, "pena.sqlite");
}

function createSequencedStore(timestampValues: string[]): SqlitePenaStore {
  const timestamps = timestampValues.map((value) => new Date(value));

  return createStore(":memory:", () => {
    const timestamp = timestamps.shift();

    if (!timestamp) {
      throw new Error("Test clock was called unexpectedly.");
    }

    return timestamp;
  });
}

function publishStoreDocument(
  store: SqlitePenaStore,
  slug: string,
  content: string,
  options?: DocumentPublishOptions,
) {
  return store.publishDocument(slug, formatTestTitle(slug), content, options);
}

function formatTestTitle(slug: string): string {
  return slug
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

interface Schema9Version {
  title: string;
  content: string;
  publishedAt: string;
}

interface Schema9Document {
  id: number;
  workspaceId: number;
  slug: string;
  versions: Schema9Version[];
  feedbackOnLatest?: string[];
}

/**
 * Builds the last workspace-era schema by hand so migration tests can start
 * from a database shaped exactly like one produced before collections.
 */
function createSchema9Database(
  databasePath: string,
  workspaces: Array<{ id: number; slug: string; name: string }> = [
    { id: 1, slug: "default", name: "Default" },
  ],
): Database.Database {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE workspaces (
      id         INTEGER PRIMARY KEY,
      slug       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE documents (
      id               INTEGER PRIMARY KEY,
      workspace_id     INTEGER NOT NULL
                       REFERENCES workspaces(id) ON DELETE RESTRICT,
      slug             TEXT NOT NULL,
      current_version  INTEGER NOT NULL CHECK (current_version >= 1),
      archived_at      TEXT,
      state_token      TEXT NOT NULL,
      UNIQUE (workspace_id, slug)
    ) STRICT;

    CREATE TABLE document_versions (
      id           INTEGER PRIMARY KEY,
      document_id  INTEGER NOT NULL
                   REFERENCES documents(id) ON DELETE CASCADE,
      version      INTEGER NOT NULL CHECK (version >= 1),
      content      TEXT NOT NULL,
      published_at TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      UNIQUE (document_id, version)
    ) STRICT;

    CREATE TABLE feedback_batches (
      id                  INTEGER PRIMARY KEY,
      document_version_id INTEGER NOT NULL
                          REFERENCES document_versions(id)
                          ON DELETE CASCADE,
      submitted_at        TEXT NOT NULL,
      comments_json       TEXT NOT NULL,
      instruction_text    TEXT
    ) STRICT;

    CREATE INDEX document_versions_document_id_version
      ON document_versions(document_id, version);

    CREATE INDEX feedback_batches_document_version_id_id
      ON feedback_batches(document_version_id, id);

    CREATE INDEX documents_workspace_id_archived_at
      ON documents(workspace_id, archived_at);

    PRAGMA user_version = 9;
  `);
  const insertWorkspace = database.prepare(
    `
      INSERT INTO workspaces (id, slug, name, created_at, updated_at)
      VALUES (?, ?, ?, '2026-07-19T09:00:00.000Z', '2026-07-19T09:00:00.000Z')
    `,
  );

  for (const workspace of workspaces) {
    insertWorkspace.run(workspace.id, workspace.slug, workspace.name);
  }

  return database;
}

function insertSchema9Document(
  database: Database.Database,
  document: Schema9Document,
): void {
  database
    .prepare(
      `
        INSERT INTO documents
          (id, workspace_id, slug, current_version, archived_at, state_token)
        VALUES (?, ?, ?, ?, NULL, lower(hex(randomblob(16))))
      `,
    )
    .run(
      document.id,
      document.workspaceId,
      document.slug,
      document.versions.length,
    );
  const insertVersion = database.prepare(
    `
      INSERT INTO document_versions
        (document_id, version, content, published_at, title)
      VALUES (?, ?, ?, ?, ?)
    `,
  );
  let latestVersionId = 0;

  document.versions.forEach((version, index) => {
    const result = insertVersion.run(
      document.id,
      index + 1,
      version.content,
      version.publishedAt,
      version.title,
    );
    latestVersionId = Number(result.lastInsertRowid);
  });

  const insertFeedback = database.prepare(
    `
      INSERT INTO feedback_batches
        (document_version_id, submitted_at, comments_json)
      VALUES (?, '2026-07-19T10:01:00.000Z', ?)
    `,
  );

  for (const comment of document.feedbackOnLatest ?? []) {
    insertFeedback.run(
      latestVersionId,
      JSON.stringify([
        {
          selectedText: "draft",
          comment,
          contextBefore: "",
          contextAfter: "",
        },
      ]),
    );
  }
}

afterEach(() => {
  for (const store of stores) {
    store.close();
  }
  stores.clear();

  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("SqlitePenaStore", () => {
  it("refuses the reserved collection slug that names the root", () => {
    const store = createStore();

    expect(() => store.createCollection("Root")).toThrow(
      CollectionNameInvalidError,
    );
    expect(() => store.createCollection("root ")).toThrow(
      CollectionNameInvalidError,
    );
    expect(store.listCollections()).toEqual([]);
  });

  it("lists document summaries by newest update without their content", () => {
    const store = createSequencedStore([
      "2026-07-19T10:00:00.000Z",
      "2026-07-19T10:01:00.000Z",
      "2026-07-19T10:02:00.000Z",
    ]);
    publishStoreDocument(store, "first-draft", "First");
    publishStoreDocument(store, "second-draft", "Second");
    publishStoreDocument(store, "first-draft", "First, revised");

    expect(store.listDocuments()).toEqual([
      {
        slug: "first-draft",
        collectionSlug: null,
        version: 2,
        updatedAt: "2026-07-19T10:02:00.000Z",
        archivedAt: null,
        title: "First Draft",
        excerpt: "First, revised",
      },
      {
        slug: "second-draft",
        collectionSlug: null,
        version: 1,
        updatedAt: "2026-07-19T10:01:00.000Z",
        archivedAt: null,
        title: "Second Draft",
        excerpt: "Second",
      },
    ]);
  });

  it("previews a document with its explicit title and opening prose", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      "initial-spec",
      [
        "---",
        "author: claude",
        "---",
        "",
        "# Pena, in **one** document",
        "",
        "Pena is a [Markdown](https://commonmark.org) review surface.",
        "",
        "```ts",
        'const ignored = "code is not prose";',
        "```",
        "",
        "## The problem it solves",
        "",
        "| Version | State |",
        "|---|---|",
        "| V1 | Live |",
        "",
        ':::pena-decision{#pick choice-a="Apply" choice-b="Skip"}',
        "An agent writes a document and publishes it here.",
        ":::",
      ].join("\n"),
    );

    const [summary] = store.listDocuments();

    expect(summary?.title).toBe("Initial Spec");
    expect(summary?.excerpt).toBe(
      "Pena is a Markdown review surface. An agent writes a document and publishes it here.",
    );
  });

  it("caps a long excerpt on a word boundary", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      "initial-spec",
      `# Long\n\n${"alpha ".repeat(120).trim()}`,
    );

    const [summary] = store.listDocuments();
    const excerpt = summary?.excerpt ?? "";

    expect(excerpt.length).toBeLessThanOrEqual(320);
    expect(excerpt.endsWith("alpha")).toBe(true);
  });

  it("creates, renames, reparents, and deletes nested collections", () => {
    const store = createSequencedStore([
      "2026-07-19T10:00:00.000Z",
      "2026-07-19T10:01:00.000Z",
      "2026-07-19T10:02:00.000Z",
      "2026-07-19T10:03:00.000Z",
      "2026-07-19T10:04:00.000Z",
      "2026-07-19T10:05:00.000Z",
    ]);

    const research = store.createCollection("Research");
    const notes = store.createCollection("Field Notes", "research");
    publishStoreDocument(store, "survey", "Survey", {
      collectionSlug: "field-notes",
    });

    expect(research).toEqual({
      slug: "research",
      name: "Research",
      parentSlug: null,
      createdAt: "2026-07-19T10:00:00.000Z",
      updatedAt: "2026-07-19T10:00:00.000Z",
    });
    expect(notes).toMatchObject({ slug: "field-notes", parentSlug: "research" });
    expect(store.listCollections()).toEqual([
      expect.objectContaining({
        slug: "field-notes",
        parentSlug: "research",
        documentCount: 1,
        childCount: 0,
      }),
      expect.objectContaining({
        slug: "research",
        parentSlug: null,
        documentCount: 0,
        childCount: 1,
      }),
    ]);

    const renamed = store.updateCollection("field-notes", { name: "Notes" });

    expect(renamed).toEqual({
      slug: "field-notes",
      name: "Notes",
      parentSlug: "research",
      createdAt: "2026-07-19T10:01:00.000Z",
      updatedAt: "2026-07-19T10:03:00.000Z",
    });
    expect(store.updateCollection("field-notes", { name: "Notes" })).toEqual(
      renamed,
    );

    const reparented = store.updateCollection("field-notes", {
      parentSlug: null,
    });

    expect(reparented).toMatchObject({
      slug: "field-notes",
      name: "Notes",
      parentSlug: null,
      updatedAt: "2026-07-19T10:04:00.000Z",
    });
    expect(store.listCollections().map(({ slug, childCount }) => [slug, childCount]))
      .toEqual([
        ["field-notes", 0],
        ["research", 0],
      ]);

    store.deleteCollection("research");

    expect(store.listCollections().map(({ slug }) => slug)).toEqual([
      "field-notes",
    ]);
    expect(() => store.deleteCollection("research")).toThrow(
      CollectionNotFoundError,
    );
  });

  it("refuses to delete a collection holding a document or a child", () => {
    const store = createStore();
    store.createCollection("Research");
    store.createCollection("Archive", "research");
    publishStoreDocument(store, "survey", "Survey", {
      collectionSlug: "archive",
    });

    expect(() => store.deleteCollection("research")).toThrow(
      CollectionNotEmptyError,
    );
    expect(() => store.deleteCollection("archive")).toThrow(
      CollectionNotEmptyError,
    );

    store.moveDocument("survey", null);
    store.deleteCollection("archive");
    store.deleteCollection("research");

    expect(store.listCollections()).toEqual([]);
  });

  it("rejects reparenting a collection into itself or a descendant", () => {
    const store = createStore();
    store.createCollection("Top");
    store.createCollection("Middle", "top");
    store.createCollection("Bottom", "middle");

    expect(() =>
      store.updateCollection("top", { parentSlug: "top" }),
    ).toThrow(CollectionCycleError);
    expect(() =>
      store.updateCollection("top", { parentSlug: "bottom" }),
    ).toThrow(CollectionCycleError);
    expect(() =>
      store.updateCollection("middle", { parentSlug: "missing" }),
    ).toThrow(CollectionNotFoundError);

    expect(
      store.updateCollection("bottom", { parentSlug: "top" }),
    ).toMatchObject({ slug: "bottom", parentSlug: "top" });
  });

  it("rejects conflicting collection names and slugs and missing parents", () => {
    const store = createStore();
    store.createCollection("Research");

    // Any name that slugifies to an existing slug is a slug clash; a name
    // clash on create is unreachable because the slug is derived from it.
    expect(() => store.createCollection("research")).toThrow(
      CollectionSlugConflictError,
    );
    expect(() => store.createCollection("  Research!  ")).toThrow(
      CollectionSlugConflictError,
    );
    expect(() => store.createCollection("Notes", "missing")).toThrow(
      CollectionNotFoundError,
    );

    store.createCollection("Notes");

    expect(() =>
      store.updateCollection("notes", { name: "RESEARCH" }),
    ).toThrow(CollectionNameConflictError);
  });

  it("archives and restores a document without losing feedback", () => {
    const store = createSequencedStore([
      "2026-07-19T10:00:00.000Z",
      "2026-07-19T10:01:00.000Z",
      "2026-07-19T10:02:00.000Z",
    ]);
    publishStoreDocument(store, "initial-spec", "Current draft");
    store.addFeedback("initial-spec", feedbackSubmission);

    const archived = store.archiveDocument("initial-spec");

    expect(archived.archivedAt).toBe("2026-07-19T10:02:00.000Z");
    expect(store.listDocuments()).toEqual([]);
    expect(store.listDocuments({ status: "archived" })).toEqual([archived]);
    expect(store.getFeedback("initial-spec").batches).toHaveLength(1);

    const restored = store.unarchiveDocument("initial-spec");

    expect(restored.archivedAt).toBeNull();
    expect(store.listDocuments()).toEqual([restored]);
    expect(store.listDocuments({ status: "archived" })).toEqual([]);
    expect(store.getFeedback("initial-spec").batches).toHaveLength(1);
  });

  it("moves an active document with its feedback into a collection and back", () => {
    const store = createStore();
    store.createCollection("Research");
    publishStoreDocument(store, "initial-spec", "Current draft");
    store.addFeedback("initial-spec", feedbackSubmission);
    const before = store.getDocumentResource("initial-spec");

    const moved = store.moveDocument("initial-spec", "research");

    expect(moved).toMatchObject({
      collectionSlug: "research",
      slug: "initial-spec",
      version: 1,
      archivedAt: null,
    });
    expect(store.getDocument("initial-spec")).toMatchObject({
      content: "Current draft",
      collectionSlug: "research",
    });
    expect(store.getDocumentResource("initial-spec")?.etag).not.toBe(
      before?.etag,
    );
    expect(store.getFeedback("initial-spec").batches).toHaveLength(1);
    expect(store.listDocuments({ collectionSlug: "research" })).toEqual([
      moved,
    ]);
    expect(store.listDocuments({ collectionSlug: null })).toEqual([]);

    expect(store.moveDocument("initial-spec", "research")).toEqual(moved);

    const returned = store.moveDocument("initial-spec", null);

    expect(returned.collectionSlug).toBeNull();
    expect(store.listDocuments({ collectionSlug: null })).toEqual([returned]);
    expect(store.getFeedback("initial-spec").batches).toHaveLength(1);
  });

  it("blocks moving archived documents and moves into missing collections", () => {
    const store = createStore();
    publishStoreDocument(store, "initial-spec", "Default");

    expect(() => store.moveDocument("initial-spec", "missing")).toThrow(
      CollectionNotFoundError,
    );

    store.archiveDocument("initial-spec");
    store.createCollection("Research");

    expect(() => store.moveDocument("initial-spec", "research")).toThrow(
      DocumentArchivedError,
    );
  });

  it("files a document on publish and refiles it without a new version", () => {
    const store = createSequencedStore([
      "2026-07-19T10:00:00.000Z",
      "2026-07-19T10:01:00.000Z",
      "2026-07-19T10:02:00.000Z",
    ]);
    store.createCollection("Research");
    store.createCollection("Notes");

    const created = publishStoreDocument(store, "initial-spec", "Draft", {
      collectionSlug: "research",
    });

    expect(created).toMatchObject({
      collectionSlug: "research",
      version: 1,
      updatedAt: "2026-07-19T10:02:00.000Z",
    });
    const beforeRefile = store.getDocumentResource("initial-spec");

    const refiled = publishStoreDocument(store, "initial-spec", "Draft", {
      collectionSlug: "notes",
    });

    expect(refiled).toMatchObject({
      collectionSlug: "notes",
      version: 1,
      updatedAt: "2026-07-19T10:02:00.000Z",
    });
    expect(store.listDocumentVersions("initial-spec")).toHaveLength(1);
    expect(store.getDocumentResource("initial-spec")?.etag).not.toBe(
      beforeRefile?.etag,
    );

    const untouched = publishStoreDocument(store, "initial-spec", "Draft");

    expect(untouched).toEqual(refiled);
    expect(store.getDocument("initial-spec")?.collectionSlug).toBe("notes");

    expect(() =>
      publishStoreDocument(store, "other-spec", "Draft", {
        collectionSlug: "missing",
      }),
    ).toThrow(CollectionNotFoundError);
  });

  it("filters document listings by collection without descending", () => {
    const store = createStore();
    store.createCollection("Research");
    store.createCollection("Notes", "research");
    publishStoreDocument(store, "root-doc", "Root");
    publishStoreDocument(store, "research-doc", "Research", {
      collectionSlug: "research",
    });
    publishStoreDocument(store, "notes-doc", "Notes", {
      collectionSlug: "notes",
    });

    const slugsOf = (documents: Array<{ slug: string }>) =>
      documents.map(({ slug }) => slug).sort();

    expect(slugsOf(store.listDocuments())).toEqual([
      "notes-doc",
      "research-doc",
      "root-doc",
    ]);
    expect(slugsOf(store.listDocuments({ collectionSlug: null }))).toEqual([
      "root-doc",
    ]);
    expect(
      slugsOf(store.listDocuments({ collectionSlug: "research" })),
    ).toEqual(["research-doc"]);
    expect(slugsOf(store.listDocuments({ collectionSlug: "notes" }))).toEqual([
      "notes-doc",
    ]);
    expect(() => store.listDocuments({ collectionSlug: "missing" })).toThrow(
      CollectionNotFoundError,
    );
  });

  it("lists archived documents everywhere and supports filtering", () => {
    const store = createSequencedStore([
      "2026-07-19T10:00:00.000Z",
      "2026-07-19T10:01:00.000Z",
      "2026-07-19T10:02:00.000Z",
      "2026-07-19T10:03:00.000Z",
      "2026-07-19T10:04:00.000Z",
    ]);
    store.createCollection("Research");
    publishStoreDocument(store, "root-draft", "Default");
    publishStoreDocument(store, "research-draft", "Research", {
      collectionSlug: "research",
    });
    store.archiveDocument("root-draft");
    store.archiveDocument("research-draft");

    expect(store.listArchivedDocuments()).toEqual([
      expect.objectContaining({
        collectionSlug: "research",
        slug: "research-draft",
      }),
      expect.objectContaining({
        collectionSlug: null,
        slug: "root-draft",
      }),
    ]);
    expect(store.listArchivedDocuments("research")).toEqual([
      expect.objectContaining({
        collectionSlug: "research",
        slug: "research-draft",
      }),
    ]);
  });

  it("only permanently deletes archived documents and cascades feedback", () => {
    const store = createStore();
    publishStoreDocument(store, "initial-spec", "Current draft");
    store.addFeedback("initial-spec", feedbackSubmission);

    expect(() => store.deleteArchivedDocument("initial-spec")).toThrow(
      DocumentNotArchivedError,
    );

    store.archiveDocument("initial-spec");
    store.deleteArchivedDocument("initial-spec");

    expect(store.getDocument("initial-spec")).toBeNull();
    expect(() => store.getFeedback("initial-spec")).toThrow(
      DocumentNotFoundError,
    );
  });

  it("requires an archived document to be explicitly unarchived before publishing", () => {
    const store = createSequencedStore([
      "2026-07-19T10:00:00.000Z",
      "2026-07-19T10:01:00.000Z",
    ]);
    publishStoreDocument(store, "initial-spec", "Current draft");
    store.archiveDocument("initial-spec");

    expect(() =>
      publishStoreDocument(store, "initial-spec", "Current draft"),
    ).toThrow(DocumentArchivedError);
    expect(store.listDocuments()).toEqual([]);
    expect(store.listDocuments({ status: "archived" })).toEqual([
      expect.objectContaining({
        slug: "initial-spec",
        archivedAt: expect.any(String),
      }),
    ]);
  });

  it("stores ordered feedback batches with numeric IDs", () => {
    const store = createStore();
    publishStoreDocument(store, "initial-spec", "Current draft");

    const firstBatch = store.addFeedback("initial-spec", feedbackSubmission);
    const secondBatch = store.addFeedback("initial-spec", {
      comments: [
        {
          selectedText: "draft",
          comment: "Use proposal instead.",
          contextBefore: "Current ",
          contextAfter: "",
        },
      ],
    });

    expect(firstBatch.id).toBe(1);
    expect(secondBatch.id).toBe(2);
    expect(store.getFeedback("initial-spec")).toEqual({
      latestBatchId: secondBatch.id,
      batches: [firstBatch, secondBatch],
    });
    expect(
      store.listFeedbackReceiptsAfter("initial-spec", firstBatch.id),
    ).toEqual([
      {
        id: secondBatch.id,
        submittedAt: secondBatch.submittedAt,
      },
    ]);
  });

  it("stores an instruction as part of its feedback batch", () => {
    const store = createStore();
    publishStoreDocument(store, "initial-spec", "Current draft");

    const batch = store.addFeedback("initial-spec", {
      instruction: "Keep the public API unchanged.",
      comments: [],
    });

    expect(batch).toEqual({
      id: 1,
      submittedAt: expect.any(String),
      instruction: "Keep the public API unchanged.",
      comments: [],
    });
    expect(store.getFeedback("initial-spec").batches).toEqual([batch]);
    expect(store.listFeedbackReceiptsAfter("initial-spec", 0)).toEqual([
      { id: batch.id, submittedAt: batch.submittedAt },
    ]);
  });

  it("isolates feedback by document ID", () => {
    const store = createStore();
    publishStoreDocument(store, "initial-spec", "Initial draft");
    publishStoreDocument(store, "article-draft", "Article draft");
    store.addFeedback("initial-spec", feedbackSubmission);
    store.addFeedback("article-draft", feedbackSubmission);

    expect(store.getFeedback("initial-spec").batches).toHaveLength(1);
    expect(store.getFeedback("article-draft").batches).toHaveLength(1);
  });

  it("preserves feedback and timestamps for identical content", () => {
    const store = createSequencedStore([
      "2026-07-19T10:00:00.000Z",
      "2026-07-19T10:01:00.000Z",
      "2026-07-19T10:02:00.000Z",
    ]);
    const firstDocument = publishStoreDocument(
      store,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback("initial-spec", feedbackSubmission);

    const repeatedDocument = publishStoreDocument(
      store,
      "initial-spec",
      "Current draft",
    );

    expect(repeatedDocument.updatedAt).toBe(firstDocument.updatedAt);
    expect(repeatedDocument.version).toBe(1);
    expect(store.getFeedback("initial-spec").batches).toHaveLength(1);
  });

  it("increments the version when changed content replaces a document", () => {
    const store = createStore();
    const firstDocument = publishStoreDocument(
      store,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback("initial-spec", feedbackSubmission);

    const replacement = publishStoreDocument(
      store,
      "initial-spec",
      "Replacement draft",
    );

    expect(firstDocument.version).toBe(1);
    expect(replacement.content).toBe("Replacement draft");
    expect(replacement.version).toBe(2);
    expect(store.getFeedback("initial-spec")).toEqual({
      latestBatchId: null,
      batches: [],
    });
  });

  it("creates a new version when only the explicit title changes", () => {
    const store = createStore();
    const first = store.publishDocument(
      "initial-spec",
      "Initial Specification",
      "Unchanged content",
    );
    store.addFeedback("initial-spec", feedbackSubmission);

    const renamed = store.publishDocument(
      "initial-spec",
      "Architecture Specification",
      "Unchanged content",
    );

    expect(first.version).toBe(1);
    expect(renamed).toMatchObject({
      title: "Architecture Specification",
      content: "Unchanged content",
      version: 2,
    });
    expect(
      store
        .listDocumentVersions("initial-spec")
        .map(({ title, version }) => ({ title, version })),
    ).toEqual([
      { title: "Architecture Specification", version: 2 },
      { title: "Initial Specification", version: 1 },
    ]);
    expect(store.getFeedback("initial-spec")).toEqual({
      latestBatchId: null,
      batches: [],
    });
  });

  it("keeps immutable document history and restores an older title and content", () => {
    const databasePath = createDatabasePath();
    const store = createStore(databasePath);
    store.publishDocument("initial-spec", "First title", "Version one");
    store.addFeedback("initial-spec", feedbackSubmission);
    store.publishDocument("initial-spec", "Second title", "Version two");
    store.publishDocument("initial-spec", "Third title", "Version three");

    expect(
      store.listDocumentVersions("initial-spec").map(({ version }) => version),
    ).toEqual([3, 2, 1]);
    expect(store.getDocumentVersion("initial-spec", 1)).toMatchObject({
      title: "First title",
      content: "Version one",
      version: 1,
      collectionSlug: null,
    });

    const restored = store.restoreDocumentVersion("initial-spec", 1);

    expect(restored).toMatchObject({
      title: "First title",
      content: "Version one",
      version: 4,
    });
    expect(store.getFeedback("initial-spec")).toEqual({
      latestBatchId: null,
      batches: [],
    });

    const inspectionDatabase = new Database(databasePath);
    const historicalFeedback = inspectionDatabase
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM feedback_batches
          JOIN document_versions
            ON document_versions.id = feedback_batches.document_version_id
          WHERE document_versions.version = 1
        `,
      )
      .get() as { count: number };
    inspectionDatabase.close();
    expect(historicalFeedback.count).toBe(1);
  });

  it("treats restoring identical content as a no-op", () => {
    const store = createStore();
    publishStoreDocument(store, "initial-spec", "Same");

    const restored = store.restoreDocumentVersion("initial-spec", 1);

    expect(restored.version).toBe(1);
    expect(store.listDocumentVersions("initial-spec")).toHaveLength(1);
  });

  it("does not restore a historical version while the document is archived", () => {
    const store = createStore();
    publishStoreDocument(store, "initial-spec", "First");
    publishStoreDocument(store, "initial-spec", "Second");
    store.archiveDocument("initial-spec");

    expect(() => store.restoreDocumentVersion("initial-spec", 1)).toThrow(
      DocumentArchivedError,
    );
  });

  it("rejects stale document state tokens after lifecycle changes", () => {
    const store = createStore();
    publishStoreDocument(store, "initial-spec", "Current");
    const resource = store.getDocumentResource("initial-spec");

    expect(resource).not.toBeNull();
    store.archiveDocument("initial-spec", resource?.etag);

    expect(() =>
      store.unarchiveDocument("initial-spec", resource?.etag),
    ).toThrow("The document changed after it was read.");
  });

  it("rolls back feedback deletion when document replacement fails", () => {
    const databasePath = createDatabasePath();
    const store = createStore(databasePath);
    publishStoreDocument(store, "initial-spec", "Current draft");
    const batch = store.addFeedback("initial-spec", feedbackSubmission);
    const triggerConnection = new Database(databasePath);
    triggerConnection.exec(`
      CREATE TRIGGER reject_document_update
      BEFORE UPDATE ON documents
      BEGIN
        SELECT RAISE(ABORT, 'forced document update failure');
      END;
    `);
    triggerConnection.close();

    expect(() =>
      publishStoreDocument(store, "initial-spec", "Replacement draft"),
    ).toThrow("forced document update failure");
    expect(store.getDocument("initial-spec")?.content).toBe("Current draft");
    expect(store.getDocument("initial-spec")?.version).toBe(1);
    expect(store.getFeedback("initial-spec")).toEqual({
      latestBatchId: batch.id,
      batches: [batch],
    });
  });

  it("persists documents and feedback after the store is reopened", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    const document = publishStoreDocument(
      firstStore,
      "initial-spec",
      "Persistent draft",
    );
    const batch = firstStore.addFeedback("initial-spec", feedbackSubmission);
    firstStore.close();
    stores.delete(firstStore);

    const reopenedStore = createStore(databasePath);

    expect(reopenedStore.getDocument("initial-spec")).toEqual(document);
    expect(reopenedStore.getFeedback("initial-spec")).toEqual({
      latestBatchId: batch.id,
      batches: [batch],
    });
  });

  it("does not rerun migrations when an initialized database is reopened", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    publishStoreDocument(firstStore, "initial-spec", "Persistent draft");
    firstStore.close();
    stores.delete(firstStore);

    const reopenedStore = createStore(databasePath);

    expect(reopenedStore.getDocument("initial-spec")?.content).toBe(
      "Persistent draft",
    );
  });

  it("migrates existing documents to version 1", () => {
    const databasePath = createDatabasePath();
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE documents (
        id         INTEGER PRIMARY KEY,
        slug       TEXT NOT NULL UNIQUE,
        content    TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE feedback_batches (
        id            INTEGER PRIMARY KEY,
        document_id   INTEGER NOT NULL
                      REFERENCES documents(id) ON DELETE CASCADE,
        submitted_at  TEXT NOT NULL,
        comments_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX feedback_batches_document_id_id
        ON feedback_batches(document_id, id);

      INSERT INTO documents (slug, content, updated_at)
      VALUES (
        'initial-spec',
        'Existing draft',
        '2026-07-19T10:00:00.000Z'
      );

      INSERT INTO feedback_batches (
        document_id,
        submitted_at,
        comments_json
      )
      VALUES (
        1,
        '2026-07-19T10:01:00.000Z',
        '[{"selectedText":"Existing","comment":"Keep this.","contextBefore":"","contextAfter":" draft"}]'
      );

      PRAGMA user_version = 1;
    `);
    database.close();

    const store = createStore(databasePath);

    expect(store.getDocument("initial-spec")).toEqual({
      slug: "initial-spec",
      collectionSlug: null,
      title: "Initial Spec",
      content: "Existing draft",
      version: 1,
      updatedAt: "2026-07-19T10:00:00.000Z",
      archivedAt: null,
    });
    expect(store.listCollections()).toEqual([]);
    expect(store.getFeedback("initial-spec").batches).toEqual([
      expect.objectContaining({
        submittedAt: "2026-07-19T10:01:00.000Z",
        comments: [expect.objectContaining({ comment: "Keep this." })],
      }),
    ]);
  });

  it("starts history at the current recoverable version when migrating schema 4", () => {
    const databasePath = createDatabasePath();
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE workspaces (
        id         INTEGER PRIMARY KEY,
        slug       TEXT NOT NULL UNIQUE,
        name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE documents (
        id           INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
        slug         TEXT NOT NULL,
        content      TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        version      INTEGER NOT NULL CHECK (version >= 1),
        archived_at  TEXT,
        UNIQUE (workspace_id, slug)
      ) STRICT;

      CREATE TABLE feedback_batches (
        id            INTEGER PRIMARY KEY,
        document_id   INTEGER NOT NULL REFERENCES documents(id),
        submitted_at  TEXT NOT NULL,
        comments_json TEXT NOT NULL
      ) STRICT;

      INSERT INTO workspaces
        (id, slug, name, created_at, updated_at)
      VALUES
        (1, 'default', 'Default', '2026-07-19T09:00:00.000Z',
         '2026-07-19T09:00:00.000Z');

      INSERT INTO documents
        (id, workspace_id, slug, content, updated_at, version, archived_at)
      VALUES
        (1, 1, 'initial-spec', 'Only recoverable content',
         '2026-07-19T10:00:00.000Z', 7, NULL);

      INSERT INTO feedback_batches
        (id, document_id, submitted_at, comments_json)
      VALUES
        (1, 1, '2026-07-19T10:01:00.000Z',
         '[{"selectedText":"content","comment":"Keep this.","contextBefore":"Only recoverable ","contextAfter":""}]');

      PRAGMA user_version = 4;
    `);
    database.close();

    const store = createStore(databasePath);

    expect(store.listDocumentVersions("initial-spec")).toEqual([
      {
        slug: "initial-spec",
        collectionSlug: null,
        title: "Initial Spec",
        version: 7,
        updatedAt: "2026-07-19T10:00:00.000Z",
      },
    ]);
    expect(store.getFeedback("initial-spec").batches).toHaveLength(1);
  });

  it("migrates numeric development state revisions to opaque ETags", () => {
    const databasePath = createDatabasePath();
    const database = createSchema9Database(databasePath);
    insertSchema9Document(database, {
      id: 1,
      workspaceId: 1,
      slug: "initial-spec",
      versions: [
        {
          title: "Initial Spec",
          content: "Existing version history",
          publishedAt: "2026-07-19T10:00:00.000Z",
        },
      ],
    });
    database.exec(`
      ALTER TABLE documents DROP COLUMN state_token;
      ALTER TABLE documents
        ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE document_versions DROP COLUMN title;
      PRAGMA user_version = 5;
    `);
    database.close();

    const migratedStore = createStore(databasePath);
    const resource = migratedStore.getDocumentResource("initial-spec");

    expect(resource?.etag).toMatch(/^"pena-[0-9a-f]{32}"$/);
    expect(resource?.value.content).toBe("Existing version history");
  });

  it("moves each legacy leading H1 into its historical version title", () => {
    const databasePath = createDatabasePath();
    const database = createSchema9Database(databasePath);
    insertSchema9Document(database, {
      id: 1,
      workspaceId: 1,
      slug: "initial-spec",
      versions: [
        {
          title: "Initial Spec",
          content: "# First title\n\nFirst body.",
          publishedAt: "2026-07-19T10:00:00.000Z",
        },
        {
          title: "Initial Spec",
          content: "Second title\n===\n\nSecond body.",
          publishedAt: "2026-07-19T10:01:00.000Z",
        },
      ],
    });
    const previousState = database
      .prepare<[], { state_token: string }>(
        "SELECT state_token FROM documents WHERE slug = 'initial-spec'",
      )
      .get();
    database.pragma("user_version = 7");
    database.close();

    const migratedStore = createStore(databasePath);
    const current = migratedStore.getDocumentResource("initial-spec");

    expect(current?.value).toMatchObject({
      title: "Second title",
      content: "Second body.",
      version: 2,
    });
    expect(current?.etag).not.toBe(`"pena-${previousState?.state_token}"`);
    expect(migratedStore.listDocumentVersions("initial-spec")).toEqual([
      expect.objectContaining({ title: "Second title", version: 2 }),
      expect.objectContaining({ title: "First title", version: 1 }),
    ]);
    expect(migratedStore.getDocumentVersion("initial-spec", 1)).toMatchObject({
      title: "First title",
      content: "First body.",
    });
  });

  it("rejects databases created by a newer schema version", () => {
    const databasePath = createDatabasePath();
    const database = new Database(databasePath);
    database.pragma("user_version = 11");
    database.close();

    expect(() => createStore(databasePath)).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it("adds nullable instructions to existing feedback batches", () => {
    const databasePath = createDatabasePath();
    const database = createSchema9Database(databasePath);
    insertSchema9Document(database, {
      id: 1,
      workspaceId: 1,
      slug: "initial-spec",
      versions: [
        {
          title: "Initial Spec",
          content: "Current draft",
          publishedAt: "2026-07-19T10:00:00.000Z",
        },
      ],
      feedbackOnLatest: ["Change this."],
    });
    database.exec(`
      ALTER TABLE feedback_batches DROP COLUMN instruction_text;
      PRAGMA user_version = 8;
    `);
    database.close();

    const migratedStore = createStore(databasePath);

    expect(migratedStore.getFeedback("initial-spec")).toEqual({
      latestBatchId: 1,
      batches: [
        expect.objectContaining({
          id: 1,
          comments: [expect.objectContaining({ comment: "Change this." })],
        }),
      ],
    });

    const inspectionDatabase = new Database(databasePath);
    expect(
      inspectionDatabase.pragma("user_version", { simple: true }),
    ).toBe(10);
    expect(
      (
        inspectionDatabase.pragma("table_info(feedback_batches)") as Array<{
          name: string;
        }>
      ).some(({ name }) => name === "instruction_text"),
    ).toBe(true);
    inspectionDatabase.close();
  });

  it("turns workspaces into root collections and default documents into root documents", () => {
    const databasePath = createDatabasePath();
    const database = createSchema9Database(databasePath, [
      { id: 1, slug: "default", name: "Default" },
      { id: 2, slug: "research", name: "Research" },
    ]);
    insertSchema9Document(database, {
      id: 1,
      workspaceId: 1,
      slug: "default-doc",
      versions: [
        {
          title: "Default Doc",
          content: "Default draft",
          publishedAt: "2026-07-19T10:00:00.000Z",
        },
      ],
      feedbackOnLatest: ["Keep default."],
    });
    insertSchema9Document(database, {
      id: 2,
      workspaceId: 2,
      slug: "research-doc",
      versions: [
        {
          title: "Research Doc",
          content: "Research draft",
          publishedAt: "2026-07-19T10:00:00.000Z",
        },
      ],
      feedbackOnLatest: ["Keep research."],
    });
    const previousTokens = database
      .prepare<[], { slug: string; state_token: string }>(
        "SELECT slug, state_token FROM documents ORDER BY id",
      )
      .all();
    database.close();

    const store = createStore(databasePath);

    expect(store.getDocument("default-doc")).toMatchObject({
      collectionSlug: null,
      content: "Default draft",
      version: 1,
    });
    expect(store.getDocument("research-doc")).toMatchObject({
      collectionSlug: "research",
      content: "Research draft",
      version: 1,
    });
    expect(store.listCollections()).toEqual([
      {
        slug: "research",
        name: "Research",
        parentSlug: null,
        createdAt: "2026-07-19T09:00:00.000Z",
        updatedAt: "2026-07-19T09:00:00.000Z",
        documentCount: 1,
        childCount: 0,
      },
    ]);
    expect(store.getFeedback("default-doc").batches).toEqual([
      expect.objectContaining({
        comments: [expect.objectContaining({ comment: "Keep default." })],
      }),
    ]);
    expect(store.getFeedback("research-doc").batches).toEqual([
      expect.objectContaining({
        comments: [expect.objectContaining({ comment: "Keep research." })],
      }),
    ]);

    // The document that left the default workspace is a different resource
    // now, so its ETag rotated; the one that stayed put kept its ETag.
    const defaultResource = store.getDocumentResource("default-doc");
    const researchResource = store.getDocumentResource("research-doc");
    expect(defaultResource?.etag).not.toBe(
      `"pena-${previousTokens[0]?.state_token}"`,
    );
    expect(researchResource?.etag).toBe(
      `"pena-${previousTokens[1]?.state_token}"`,
    );

    // Writing through every foreign key proves the rebuilt documents table is
    // what document_versions and feedback_batches point at.
    for (const slug of ["default-doc", "research-doc"]) {
      const resource = store.getDocumentResource(slug);
      const republished = store.publishDocument(
        slug,
        formatTestTitle(slug),
        "Revised draft",
        { condition: { kind: "match", etag: resource?.etag ?? "" } },
      );

      expect(republished.version).toBe(2);
      expect(store.listDocumentVersions(slug)).toHaveLength(2);

      const batch = store.addFeedback(
        slug,
        feedbackSubmission,
        store.getDocumentResource(slug)?.etag,
      );

      expect(store.getFeedback(slug)).toEqual({
        latestBatchId: batch.id,
        batches: [batch],
      });
    }

    store.archiveDocument("default-doc", store.getDocumentResource("default-doc")?.etag);
    store.deleteArchivedDocument("default-doc");
    expect(store.getDocument("default-doc")).toBeNull();

    const inspectionDatabase = new Database(databasePath);
    expect(
      inspectionDatabase.pragma("user_version", { simple: true }),
    ).toBe(10);
    expect(
      inspectionDatabase
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'",
        )
        .get(),
    ).toBeUndefined();
    expect(inspectionDatabase.pragma("foreign_key_check")).toEqual([]);
    inspectionDatabase.close();
  });

  it("refuses to migrate when a document slug exists in more than one workspace", () => {
    const databasePath = createDatabasePath();
    const database = createSchema9Database(databasePath, [
      { id: 1, slug: "default", name: "Default" },
      { id: 2, slug: "research", name: "Research" },
    ]);
    insertSchema9Document(database, {
      id: 1,
      workspaceId: 1,
      slug: "shared-draft",
      versions: [
        {
          title: "Shared Draft",
          content: "Default",
          publishedAt: "2026-07-19T10:00:00.000Z",
        },
      ],
    });
    insertSchema9Document(database, {
      id: 2,
      workspaceId: 2,
      slug: "shared-draft",
      versions: [
        {
          title: "Shared Draft",
          content: "Research",
          publishedAt: "2026-07-19T10:00:00.000Z",
        },
      ],
    });
    database.close();

    expect(() => createStore(databasePath)).toThrow(
      DocumentSlugConflictMigrationError,
    );
    expect(() => createStore(databasePath)).toThrow(/shared-draft/);

    const inspectionDatabase = new Database(databasePath);
    expect(
      inspectionDatabase.pragma("user_version", { simple: true }),
    ).toBe(9);
    expect(
      inspectionDatabase
        .prepare("SELECT COUNT(*) AS count FROM workspaces")
        .get(),
    ).toEqual({ count: 2 });
    expect(
      inspectionDatabase
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collections'",
        )
        .get(),
    ).toBeUndefined();
    inspectionDatabase.close();
  });

  it("rolls back a failed migration", () => {
    const databasePath = createDatabasePath();
    const database = new Database(databasePath);
    database.exec(
      "CREATE TABLE feedback_batches (sentinel TEXT NOT NULL) STRICT;",
    );
    database.close();

    expect(() => createStore(databasePath)).toThrow(
      /table feedback_batches already exists/,
    );

    const inspectionDatabase = new Database(databasePath);
    const schemaVersion = inspectionDatabase.pragma("user_version", {
      simple: true,
    });
    const documentsTable = inspectionDatabase
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'documents'
        `,
      )
      .get();
    inspectionDatabase.close();

    expect(schemaVersion).toBe(0);
    expect(documentsTable).toBeUndefined();
  });

  it("rejects invalid persisted comment data", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    publishStoreDocument(firstStore, "initial-spec", "Persistent draft");
    firstStore.addFeedback("initial-spec", feedbackSubmission);
    firstStore.close();
    stores.delete(firstStore);

    const database = new Database(databasePath);
    database
      .prepare("UPDATE feedback_batches SET comments_json = ?")
      .run("{not-json");
    database.close();
    const reopenedStore = createStore(databasePath);

    expect(() => reopenedStore.getFeedback("initial-spec")).toThrow(
      PersistedDataError,
    );
  });

  it("rejects feedback operations for a missing document", () => {
    const store = createStore();

    expect(() =>
      store.addFeedback("missing-document", feedbackSubmission),
    ).toThrow(DocumentNotFoundError);
    expect(() => store.getFeedback("missing-document")).toThrow(
      DocumentNotFoundError,
    );
  });
});
