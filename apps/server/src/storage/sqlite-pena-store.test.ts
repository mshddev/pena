import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  DocumentNotArchivedError,
  DocumentNotFoundError,
  PersistedDataError,
  UnsupportedSchemaVersionError,
} from "./pena-store.js";
import { DEFAULT_WORKSPACE_SLUG, SqlitePenaStore } from "./sqlite-pena-store.js";

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
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "first-draft", "First");
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "second-draft", "Second");
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "first-draft", "First, revised");

    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG)).toEqual([
      {
        workspaceSlug: "default",
        slug: "first-draft",
        version: 2,
        updatedAt: "2026-07-19T10:02:00.000Z",
        archivedAt: null,
      },
      {
        workspaceSlug: "default",
        slug: "second-draft",
        version: 1,
        updatedAt: "2026-07-19T10:01:00.000Z",
        archivedAt: null,
      },
    ]);
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
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Current draft");
    store.addFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec", feedbackSubmission);

    const archived = store.archiveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");

    expect(archived.archivedAt).toBe("2026-07-19T10:02:00.000Z");
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG)).toEqual([]);
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG, "archived")).toEqual([archived]);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches).toHaveLength(1);

    const restored = store.restoreDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");

    expect(restored.archivedAt).toBeNull();
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG)).toEqual([restored]);
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG, "archived")).toEqual([]);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches).toHaveLength(1);
  });

  it("only permanently deletes archived documents and cascades feedback", () => {
    const store = createStore();
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Current draft");
    store.addFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec", feedbackSubmission);

    expect(() => store.deleteArchivedDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toThrow(
      DocumentNotArchivedError,
    );

    store.archiveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");
    store.deleteArchivedDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");

    expect(store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toBeNull();
    expect(() => store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toThrow(
      DocumentNotFoundError,
    );
  });

  it("automatically restores an archived slug when it is published again", () => {
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
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Current draft");
    store.archiveDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec");

    const republished = store.publishDocument(DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );

    expect(republished.version).toBe(1);
    expect(republished.updatedAt).toBe("2026-07-19T10:02:00.000Z");
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG)).toEqual([
      expect.objectContaining({ slug: "initial-spec", archivedAt: null }),
    ]);
    expect(store.listDocuments(DEFAULT_WORKSPACE_SLUG, "archived")).toEqual([]);
  });

  it("stores ordered feedback batches with numeric IDs", () => {
    const store = createStore();
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Current draft");

    const firstBatch = store.addFeedback(DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
    const secondBatch = store.addFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec", {
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
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      batches: [firstBatch, secondBatch],
    });
  });

  it("isolates feedback by document ID", () => {
    const store = createStore();
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Initial draft");
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "article-draft", "Article draft");
    store.addFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec", feedbackSubmission);
    store.addFeedback(DEFAULT_WORKSPACE_SLUG, "article-draft", feedbackSubmission);

    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches).toHaveLength(1);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "article-draft").batches).toHaveLength(1);
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
    const firstDocument = store.publishDocument(DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec", feedbackSubmission);

    const repeatedDocument = store.publishDocument(DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );

    expect(repeatedDocument.updatedAt).toBe(firstDocument.updatedAt);
    expect(repeatedDocument.version).toBe(1);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec").batches).toHaveLength(1);
  });

  it("increments the version when changed content replaces a document", () => {
    const store = createStore();
    const firstDocument = store.publishDocument(DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Current draft",
    );
    store.addFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec", feedbackSubmission);

    const replacement = store.publishDocument(DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Replacement draft",
    );

    expect(firstDocument.version).toBe(1);
    expect(replacement.content).toBe("Replacement draft");
    expect(replacement.version).toBe(2);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({ batches: [] });
  });

  it("rolls back feedback deletion when document replacement fails", () => {
    const databasePath = createDatabasePath();
    const store = createStore(databasePath);
    store.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Current draft");
    const batch = store.addFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec", feedbackSubmission);
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
      store.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Replacement draft"),
    ).toThrow("forced document update failure");
    expect(store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")?.content).toBe(
      "Current draft",
    );
    expect(store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")?.version).toBe(1);
    expect(store.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      batches: [batch],
    });
  });

  it("persists documents and feedback after the store is reopened", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    const document = firstStore.publishDocument(DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      "Persistent draft",
    );
    const batch = firstStore.addFeedback(DEFAULT_WORKSPACE_SLUG,
      "initial-spec",
      feedbackSubmission,
    );
    firstStore.close();
    stores.delete(firstStore);

    const reopenedStore = createStore(databasePath);

    expect(reopenedStore.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual(document);
    expect(reopenedStore.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      batches: [batch],
    });
  });

  it("does not rerun migrations when an initialized database is reopened", () => {
    const databasePath = createDatabasePath();
    const firstStore = createStore(databasePath);
    firstStore.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Persistent draft");
    firstStore.close();
    stores.delete(firstStore);

    const reopenedStore = createStore(databasePath);

    expect(reopenedStore.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")?.content).toBe(
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

    expect(store.getDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toEqual({
      workspaceSlug: "default",
      slug: "initial-spec",
      content: "Existing draft",
      version: 1,
      updatedAt: "2026-07-19T10:00:00.000Z",
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

  it("rejects databases created by a newer schema version", () => {
    const databasePath = createDatabasePath();
    const database = new Database(databasePath);
    database.pragma("user_version = 5");
    database.close();

    expect(() => createStore(databasePath)).toThrow(
      UnsupportedSchemaVersionError,
    );
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
    firstStore.publishDocument(DEFAULT_WORKSPACE_SLUG, "initial-spec", "Persistent draft");
    firstStore.addFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec", feedbackSubmission);
    firstStore.close();
    stores.delete(firstStore);

    const database = new Database(databasePath);
    database
      .prepare("UPDATE feedback_batches SET comments_json = ?")
      .run("{not-json");
    database.close();
    const reopenedStore = createStore(databasePath);

    expect(() => reopenedStore.getFeedback(DEFAULT_WORKSPACE_SLUG, "initial-spec")).toThrow(
      PersistedDataError,
    );
  });

  it("rejects feedback operations for a missing document", () => {
    const store = createStore();

    expect(() =>
      store.addFeedback(DEFAULT_WORKSPACE_SLUG, "missing-document", feedbackSubmission),
    ).toThrow(DocumentNotFoundError);
    expect(() => store.getFeedback(DEFAULT_WORKSPACE_SLUG, "missing-document")).toThrow(
      DocumentNotFoundError,
    );
  });
});
