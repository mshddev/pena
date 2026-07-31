import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  DocumentArchivedError,
  DocumentNotArchivedError,
  DocumentNotFoundError,
  DocumentSlugConflictError,
  PersistedDataError,
  UnsupportedSchemaVersionError,
  type DocumentWriteCondition,
} from "./pena-store.js";
import {
  DEFAULT_WORKSPACE_SLUG,
  SqlitePenaStore,
} from "./sqlite-pena-store.js";

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

function publishStoreDocument(
  store: SqlitePenaStore,
  workspaceSlug: string,
  slug: string,
  content: string,
  condition?: DocumentWriteCondition,
  expectedLatestFeedbackBatchId?: number,
) {
  return store.publishDocument(
    workspaceSlug,
    slug,
    formatTestTitle(slug),
    content,
    condition,
    expectedLatestFeedbackBatchId,
  );
}

function formatTestTitle(slug: string): string {
  return slug
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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
  it("lists document summaries by newest update without their content", () => {
    const timestamps = [
      new Date("2026-07-19T10:00:00.000Z"),
      new Date("2026-07-19T10:01:00.000Z"),
      new Date("2026-07-19T10:02:00.000Z"),
    ];
    const store = createStore(":memory:", () => {
      const timestamp = timestamps.shift();

      if (!timestamp) {
        throw new Error("Test clock was called unexpectedly.");
      }

      return timestamp;
    });
    publishStoreDocument(store, DEFAULT_WORKSPACE_SLUG, "first-draft", "First");
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "second-draft",
      "Second",
    );
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "first-draft",
      "First, revised",
    );

    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG)).toEqual([
      {
        workspaceSlug: "default",
        slug: "first-draft",
        version: 2,
        updatedAt: "2026-07-19T10:02:00.000Z",
        archivedAt: null,
        title: "First Draft",
        excerpt: "First, revised",
      },
      {
        workspaceSlug: "default",
        slug: "second-draft",
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
      DEFAULT_WORKSPACE_SLUG,
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

    const [summary] = store.listDocuments(DEFAULT_WORKSPACE_SLUG);

    expect(summary?.title).toBe("Initial Spec");
    expect(summary?.excerpt).toBe(
      "Pena is a Markdown review surface. An agent writes a document and publishes it here.",
    );
  });

  it("caps a long excerpt on a word boundary", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      `# Long\n\n${"alpha ".repeat(120).trim()}`,
    );

    const [summary] = store.listDocuments(DEFAULT_WORKSPACE_SLUG);
    const excerpt = summary?.excerpt ?? "";

    expect(excerpt.length).toBeLessThanOrEqual(320);
    expect(excerpt.endsWith("alpha")).toBe(true);
  });

  it("archives and restores a document without losing feedback", () => {
    const timestamps = [
      new Date("2026-07-19T10:00:00.000Z"),
      new Date("2026-07-19T10:01:00.000Z"),
      new Date("2026-07-19T10:02:00.000Z"),
    ];
    const store = createStore(":memory:", () => {
      const timestamp = timestamps.shift();

      if (!timestamp) {
        throw new Error("Test clock was called unexpectedly.");
      }

      return timestamp;
    });
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );

    const archived = store.archiveDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
    );

    expect(archived.archivedAt).toBe("2026-07-19T10:02:00.000Z");
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG)).toEqual([]);
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG, "archived")).toEqual([
      archived,
    ]);
    expect(
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches,
    ).toHaveLength(1);

    const restored = store.unarchiveDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
    );

    expect(restored.archivedAt).toBeNull();
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG)).toEqual([restored]);
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG, "archived")).toEqual([]);
    expect(
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches,
    ).toHaveLength(1);
  });

  it("moves an active document and its feedback to another workspace", () => {
    const store = createStore();
    store.createWorkspace("Research");
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );

    const moved = store.moveDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "research",
    );

    expect(moved).toMatchObject({
      workspaceSlug: "research",
      slug: "initial-spec",
      version: 1,
      archivedAt: null,
    });
    expect(
      store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toBeNull();
    expect(store.getDocument("research", "initial-spec")).toMatchObject({
      content: "Current draft",
      workspaceSlug: "research",
    });
    expect(store.getFeedback("research", "initial-spec").batches).toHaveLength(
      1,
    );
  });

  it("blocks moving archived documents and destination slug collisions", () => {
    const store = createStore();
    store.createWorkspace("Research");
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Default",
    );
    publishStoreDocument(store, "research", "initial-spec", "Research");

    expect(() =>
      store.moveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "research"),
    ).toThrow(DocumentSlugConflictError);

    store.archiveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");
    expect(() =>
      store.moveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "research"),
    ).toThrow(DocumentArchivedError);
  });

  it("lists archived documents across workspaces and supports filtering", () => {
    const timestamps = [
      new Date("2026-07-19T10:00:00.000Z"),
      new Date("2026-07-19T10:01:00.000Z"),
      new Date("2026-07-19T10:02:00.000Z"),
      new Date("2026-07-19T10:03:00.000Z"),
      new Date("2026-07-19T10:04:00.000Z"),
    ];
    const store = createStore(":memory:", () => {
      const timestamp = timestamps.shift();

      if (!timestamp) {
        throw new Error("Test clock was called unexpectedly.");
      }

      return timestamp;
    });
    store.createWorkspace("Research");
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "shared-draft",
      "Default",
    );
    publishStoreDocument(store, "research", "shared-draft", "Research");
    store.archiveDocument(DEFAULT_WORKSPACE_SLUG, "shared-draft");
    store.archiveDocument("research", "shared-draft");

    expect(store.listArchivedDocuments()).toEqual([
      expect.objectContaining({
        workspaceSlug: "research",
        slug: "shared-draft",
      }),
      expect.objectContaining({
        workspaceSlug: DEFAULT_WORKSPACE_SLUG,
        slug: "shared-draft",
      }),
    ]);
    expect(store.listArchivedDocuments("research")).toEqual([
      expect.objectContaining({
        workspaceSlug: "research",
        slug: "shared-draft",
      }),
    ]);
  });

  it("only permanently deletes archived documents and cascades feedback", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );

    expect(() =>
      store.deleteArchivedDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toThrow(DocumentNotArchivedError);

    store.archiveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");
    store.deleteArchivedDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");

    expect(
      store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toBeNull();
    expect(() =>
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toThrow(DocumentNotFoundError);
  });

  it("requires an archived document to be explicitly unarchived before publishing", () => {
    const timestamps = [
      new Date("2026-07-19T10:00:00.000Z"),
      new Date("2026-07-19T10:01:00.000Z"),
    ];
    const store = createStore(":memory:", () => {
      const timestamp = timestamps.shift();

      if (!timestamp) {
        throw new Error("Test clock was called unexpectedly.");
      }

      return timestamp;
    });
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    store.archiveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");

    expect(() =>
      publishStoreDocument(
        store,
        DEFAULT_WORKSPACE_SLUG,
        "initial-spec",
        "Current draft",
      ),
    ).toThrow(DocumentArchivedError);
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG)).toEqual([]);
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG, "archived")).toEqual([
      expect.objectContaining({
        slug: "initial-spec",
        archivedAt: expect.any(String),
      }),
    ]);
  });

  it("stores ordered feedback batches with numeric IDs", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );

    const firstBatch = store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
    const secondBatch = store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      {
        comments: [
          {
            selectedText: "draft",
            comment: "Use proposal instead.",
            contextBefore: "Current ",
            contextAfter: "",
          },
        ],
      },
    );

    expect(firstBatch.id).toBe(1);
    expect(secondBatch.id).toBe(2);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      latestBatchId: secondBatch.id,
      batches: [firstBatch, secondBatch],
    });
    expect(
      store.listFeedbackReceiptsAfter(
        DEFAULT_WORKSPACE_SLUG,
        "initial-spec",
        firstBatch.id,
      ),
    ).toEqual([
      {
        id: secondBatch.id,
        submittedAt: secondBatch.submittedAt,
      },
    ]);
  });

  it("stores an instruction as part of its feedback batch", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );

    const batch = store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      {
        instruction: "Keep the public API unchanged.",
        comments: [],
      },
    );

    expect(batch).toEqual({
      id: 1,
      submittedAt: expect.any(String),
      instruction: "Keep the public API unchanged.",
      comments: [],
    });
    expect(
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches,
    ).toEqual([batch]);
    expect(
      store.listFeedbackReceiptsAfter(
        DEFAULT_WORKSPACE_SLUG,
        "initial-spec",
        0,
      ),
    ).toEqual([
      { id: batch.id, submittedAt: batch.submittedAt },
    ]);
  });

  it("isolates feedback by document ID", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Initial draft",
    );
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "article-draft",
      "Article draft",
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "article-draft",
      feedbackSubmission,
    );

    expect(
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches,
    ).toHaveLength(1);
    expect(
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "article-draft").batches,
    ).toHaveLength(1);
  });

  it("preserves feedback and timestamps for identical content", () => {
    const timestamps = [
      new Date("2026-07-19T10:00:00.000Z"),
      new Date("2026-07-19T10:01:00.000Z"),
      new Date("2026-07-19T10:02:00.000Z"),
    ];
    const store = createStore(":memory:", () => {
      const timestamp = timestamps.shift();

      if (!timestamp) {
        throw new Error("Test clock was called unexpectedly.");
      }

      return timestamp;
    });
    const firstDocument = publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );

    const repeatedDocument = publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );

    expect(repeatedDocument.updatedAt).toBe(firstDocument.updatedAt);
    expect(repeatedDocument.version).toBe(1);
    expect(
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches,
    ).toHaveLength(1);
  });

  it("increments the version when changed content replaces a document", () => {
    const store = createStore();
    const firstDocument = publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );

    const replacement = publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Replacement draft",
    );

    expect(firstDocument.version).toBe(1);
    expect(replacement.content).toBe("Replacement draft");
    expect(replacement.version).toBe(2);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      latestBatchId: null,
      batches: [],
    });
  });

  it("creates a new version when only the explicit title changes", () => {
    const store = createStore();
    const first = store.publishDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Initial Specification",
      "Unchanged content",
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );

    const renamed = store.publishDocument(
      DEFAULT_WORKSPACE_SLUG,
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
        .listDocumentVersions(DEFAULT_WORKSPACE_SLUG, "initial-spec")
        .map(({ title, version }) => ({ title, version })),
    ).toEqual([
      { title: "Architecture Specification", version: 2 },
      { title: "Initial Specification", version: 1 },
    ]);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      latestBatchId: null,
      batches: [],
    });
  });

  it("keeps immutable document history and restores an older title and content", () => {
    const databasePath = createDatabasePath();
    const store = createStore(databasePath);
    store.publishDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "First title",
      "Version one",
    );
    store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
    store.publishDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Second title",
      "Version two",
    );
    store.publishDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Third title",
      "Version three",
    );

    expect(
      store
        .listDocumentVersions(DEFAULT_WORKSPACE_SLUG, "initial-spec")
        .map(({ version }) => version),
    ).toEqual([3, 2, 1]);
    expect(
      store.getDocumentVersion(DEFAULT_WORKSPACE_SLUG, "initial-spec", 1),
    ).toMatchObject({
      title: "First title",
      content: "Version one",
      version: 1,
    });

    const restored = store.restoreDocumentVersion(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      1,
    );

    expect(restored).toMatchObject({
      title: "First title",
      content: "Version one",
      version: 4,
    });
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
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
    publishStoreDocument(store, DEFAULT_WORKSPACE_SLUG, "initial-spec", "Same");

    const restored = store.restoreDocumentVersion(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      1,
    );

    expect(restored.version).toBe(1);
    expect(
      store.listDocumentVersions(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toHaveLength(1);
  });

  it("does not restore a historical version while the document is archived", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "First",
    );
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Second",
    );
    store.archiveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");

    expect(() =>
      store.restoreDocumentVersion(DEFAULT_WORKSPACE_SLUG, "initial-spec", 1),
    ).toThrow(DocumentArchivedError);
  });

  it("rejects stale document state tokens after lifecycle changes", () => {
    const store = createStore();
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current",
    );
    const resource = store.getDocumentResource(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
    );

    expect(resource).not.toBeNull();
    store.archiveDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      resource?.etag,
    );

    expect(() =>
      store.unarchiveDocument(
        DEFAULT_WORKSPACE_SLUG,
        "initial-spec",
        resource?.etag,
      ),
    ).toThrow("The document changed after it was read.");
  });

  it("rolls back feedback deletion when document replacement fails", () => {
    const databasePath = createDatabasePath();
    const store = createStore(databasePath);
    publishStoreDocument(
      store,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    const batch = store.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
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
      publishStoreDocument(
        store,
        DEFAULT_WORKSPACE_SLUG,
        "initial-spec",
        "Replacement draft",
      ),
    ).toThrow("forced document update failure");
    expect(
      store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")?.content,
    ).toBe("Current draft");
    expect(
      store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")?.version,
    ).toBe(1);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      latestBatchId: batch.id,
      batches: [batch],
    });
  });

  it("persists documents and feedback after the store is reopened", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    const document = publishStoreDocument(
      firstStore,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Persistent draft",
    );
    const batch = firstStore.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
    firstStore.close();
    stores.delete(firstStore);

    const reopenedStore = createStore(databasePath);

    expect(
      reopenedStore.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toEqual(document);
    expect(
      reopenedStore.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toEqual({
      latestBatchId: batch.id,
      batches: [batch],
    });
  });

  it("does not rerun migrations when an initialized database is reopened", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    publishStoreDocument(
      firstStore,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Persistent draft",
    );
    firstStore.close();
    stores.delete(firstStore);

    const reopenedStore = createStore(databasePath);

    expect(
      reopenedStore.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")
        ?.content,
    ).toBe("Persistent draft");
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

    expect(store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      workspaceSlug: "default",
      slug: "initial-spec",
      title: "Initial Spec",
      content: "Existing draft",
      version: 1,
      updatedAt: "2026-07-19T10:00:00.000Z",
      archivedAt: null,
    });
    expect(store.listWorkspaces()).toEqual([
      expect.objectContaining({
        slug: "default",
        name: "Default",
        documentCount: 1,
      }),
    ]);
    expect(
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches,
    ).toEqual([
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

    expect(
      store.listDocumentVersions(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toEqual([
      {
        workspaceSlug: "default",
        slug: "initial-spec",
        title: "Initial Spec",
        version: 7,
        updatedAt: "2026-07-19T10:00:00.000Z",
      },
    ]);
    expect(
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches,
    ).toHaveLength(1);
  });

  it("migrates numeric development state revisions to opaque ETags", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    publishStoreDocument(
      firstStore,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Existing version history",
    );
    firstStore.close();
    stores.delete(firstStore);

    const database = new Database(databasePath);
    database.exec(`
      ALTER TABLE documents DROP COLUMN state_token;
      ALTER TABLE documents
        ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE document_versions DROP COLUMN title;
      PRAGMA user_version = 5;
    `);
    database.close();

    const migratedStore = createStore(databasePath);
    const resource = migratedStore.getDocumentResource(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
    );

    expect(resource?.etag).toMatch(/^"pena-[0-9a-f]{32}"$/);
    expect(resource?.value.content).toBe("Existing version history");
  });

  it("moves each legacy leading H1 into its historical version title", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    firstStore.publishDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Legacy Fallback",
      "# First title\n\nFirst body.",
    );
    firstStore.publishDocument(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Legacy Fallback",
      "Second title\n===\n\nSecond body.",
    );
    firstStore.close();
    stores.delete(firstStore);

    const database = new Database(databasePath);
    const previousState = database
      .prepare<[], { state_token: string }>(
        "SELECT state_token FROM documents WHERE slug = 'initial-spec'",
      )
      .get();
    database.exec(`
      UPDATE document_versions SET title = 'Initial Spec';
      PRAGMA user_version = 7;
    `);
    database.close();

    const migratedStore = createStore(databasePath);
    const current = migratedStore.getDocumentResource(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
    );

    expect(current?.value).toMatchObject({
      title: "Second title",
      content: "Second body.",
      version: 2,
    });
    expect(current?.etag).not.toBe(`"pena-${previousState?.state_token}"`);
    expect(
      migratedStore.listDocumentVersions(
        DEFAULT_WORKSPACE_SLUG,
        "initial-spec",
      ),
    ).toEqual([
      expect.objectContaining({ title: "Second title", version: 2 }),
      expect.objectContaining({ title: "First title", version: 1 }),
    ]);
    expect(
      migratedStore.getDocumentVersion(
        DEFAULT_WORKSPACE_SLUG,
        "initial-spec",
        1,
      ),
    ).toMatchObject({
      title: "First title",
      content: "First body.",
    });
  });

  it("rejects databases created by a newer schema version", () => {
    const databasePath = createDatabasePath();
    const database = new Database(databasePath);
    database.pragma("user_version = 10");
    database.close();

    expect(() => createStore(databasePath)).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it("adds nullable instructions to existing feedback batches", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    publishStoreDocument(
      firstStore,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    const existingBatch = firstStore.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
    firstStore.close();
    stores.delete(firstStore);

    const database = new Database(databasePath);
    database.exec(`
      ALTER TABLE feedback_batches DROP COLUMN instruction_text;
      PRAGMA user_version = 8;
    `);
    database.close();

    const migratedStore = createStore(databasePath);

    expect(
      migratedStore.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toEqual({
      latestBatchId: existingBatch.id,
      batches: [existingBatch],
    });

    const inspectionDatabase = new Database(databasePath);
    expect(
      inspectionDatabase.pragma("user_version", { simple: true }),
    ).toBe(9);
    expect(
      (
        inspectionDatabase.pragma("table_info(feedback_batches)") as Array<{
          name: string;
        }>
      ).some(({ name }) => name === "instruction_text"),
    ).toBe(true);
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
    publishStoreDocument(
      firstStore,
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Persistent draft",
    );
    firstStore.addFeedback(
      DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
    firstStore.close();
    stores.delete(firstStore);

    const database = new Database(databasePath);
    database
      .prepare("UPDATE feedback_batches SET comments_json = ?")
      .run("{not-json");
    database.close();
    const reopenedStore = createStore(databasePath);

    expect(() =>
      reopenedStore.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec"),
    ).toThrow(PersistedDataError);
  });

  it("rejects feedback operations for a missing document", () => {
    const store = createStore();

    expect(() =>
      store.addFeedback(
        DEFAULT_WORKSPACE_SLUG,
        "missing-document",
        feedbackSubmission,
      ),
    ).toThrow(DocumentNotFoundError);
    expect(() =>
      store.getFeedback(DEFAULT_WORKSPACE_SLUG, "missing-document"),
    ).toThrow(DocumentNotFoundError);
  });
});
