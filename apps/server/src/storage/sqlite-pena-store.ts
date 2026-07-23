import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  DocumentSchema,
  DocumentSummarySchema,
  FeedbackBatchSchema,
  FeedbackResponseSchema,
  FeedbackSubmissionSchema,
  WorkspaceNameSchema,
  WorkspaceSchema,
  WorkspaceSummarySchema,
  type DocumentSummary,
  type DocumentStatus,
  type FeedbackBatch,
  type FeedbackResponse,
  type FeedbackSubmission,
  type PenaDocument,
  type Workspace,
  type WorkspaceSummary,
} from "@pena/contracts";
import Database from "better-sqlite3";

import {
  DefaultWorkspaceProtectedError,
  DocumentNotArchivedError,
  DocumentNotFoundError,
  PersistedDataError,
  UnsupportedSchemaVersionError,
  WorkspaceNameConflictError,
  WorkspaceNameInvalidError,
  WorkspaceNotEmptyError,
  WorkspaceNotFoundError,
  WorkspaceSlugConflictError,
  type PenaStore,
} from "./pena-store.js";

export const DEFAULT_WORKSPACE_SLUG = "default";

const CURRENT_SCHEMA_VERSION = 4;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

interface SqlitePenaStoreOptions {
  clock?: () => Date;
}

interface WorkspaceRow {
  id: number;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface WorkspaceSummaryRow extends WorkspaceRow {
  document_count: number;
}

interface DocumentRow {
  id: number;
  workspace_id: number;
  workspace_slug: string;
  slug: string;
  content: string;
  version: number;
  updated_at: string;
  archived_at: string | null;
}

interface DocumentSummaryRow {
  workspace_slug: string;
  slug: string;
  version: number;
  updated_at: string;
  archived_at: string | null;
}

interface FeedbackBatchRow {
  id: number;
  submitted_at: string;
  comments_json: string;
}

export class SqlitePenaStore implements PenaStore {
  private readonly database: Database.Database;
  private readonly clock: () => Date;
  private readonly publishDocumentTransaction: (
    workspaceSlug: string,
    slug: string,
    content: string,
  ) => PenaDocument;

  constructor(
    filename: string,
    { clock = () => new Date() }: SqlitePenaStoreOptions = {},
  ) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(filename), { recursive: true });
    }

    this.database = new Database(filename, {
      timeout: DEFAULT_BUSY_TIMEOUT_MS,
    });
    this.clock = clock;

    try {
      configureDatabase(this.database);
      migrateDatabase(this.database);
    } catch (error) {
      this.database.close();
      throw error;
    }

    this.publishDocumentTransaction = this.database.transaction(
      (
        workspaceSlug: string,
        slug: string,
        content: string,
      ): PenaDocument => {
        const workspace = this.requireWorkspaceRow(workspaceSlug);
        const currentDocument = this.getDocumentRow(workspace.id, slug);

        if (!currentDocument) {
          const updatedAt = this.clock().toISOString();
          this.database
            .prepare<[number, string, string, string]>(
              `
                INSERT INTO documents (
                  workspace_id,
                  slug,
                  content,
                  updated_at
                )
                VALUES (?, ?, ?, ?)
              `,
            )
            .run(workspace.id, slug, content, updatedAt);

          return DocumentSchema.parse({
            workspaceSlug,
            slug,
            content,
            version: 1,
            updatedAt,
          });
        }

        if (
          currentDocument.content === content &&
          currentDocument.archived_at === null
        ) {
          return toDocument(currentDocument);
        }

        const updatedAt = this.clock().toISOString();

        if (currentDocument.content === content) {
          this.database
            .prepare<[string, number]>(
              `
                UPDATE documents
                SET archived_at = NULL, updated_at = ?
                WHERE id = ?
              `,
            )
            .run(updatedAt, currentDocument.id);

          return DocumentSchema.parse({
            workspaceSlug,
            slug,
            content,
            version: currentDocument.version,
            updatedAt,
          });
        }

        this.database
          .prepare<[number]>(
            "DELETE FROM feedback_batches WHERE document_id = ?",
          )
          .run(currentDocument.id);
        this.database
          .prepare<[string, string, number]>(
            `
              UPDATE documents
              SET content = ?,
                  version = version + 1,
                  updated_at = ?,
                  archived_at = NULL
              WHERE id = ?
            `,
          )
          .run(content, updatedAt, currentDocument.id);

        return DocumentSchema.parse({
          workspaceSlug,
          slug,
          content,
          version: currentDocument.version + 1,
          updatedAt,
        });
      },
    );
  }

  listWorkspaces(): WorkspaceSummary[] {
    const rows = this.database
      .prepare<[], WorkspaceSummaryRow>(
        `
          SELECT
            workspaces.id,
            workspaces.slug,
            workspaces.name,
            workspaces.created_at,
            workspaces.updated_at,
            COUNT(documents.id) AS document_count
          FROM workspaces
          LEFT JOIN documents ON documents.workspace_id = workspaces.id
          GROUP BY workspaces.id
          ORDER BY
            CASE WHEN workspaces.slug = 'default' THEN 0 ELSE 1 END,
            workspaces.name COLLATE NOCASE,
            workspaces.id
        `,
      )
      .all();

    return rows.map(toWorkspaceSummary);
  }

  createWorkspace(name: string): Workspace {
    const parsedName = WorkspaceNameSchema.parse(name);
    const slug = slugifyWorkspaceName(parsedName);

    if (!slug) {
      throw new WorkspaceNameInvalidError();
    }

    if (this.getWorkspaceRow(slug)) {
      throw new WorkspaceSlugConflictError(slug);
    }

    if (this.getWorkspaceRowByName(parsedName)) {
      throw new WorkspaceNameConflictError(parsedName);
    }

    const timestamp = this.clock().toISOString();
    this.database
      .prepare<[string, string, string, string]>(
        `
          INSERT INTO workspaces (slug, name, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(slug, parsedName, timestamp, timestamp);

    return WorkspaceSchema.parse({
      slug,
      name: parsedName,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  renameWorkspace(slug: string, name: string): Workspace {
    const workspace = this.requireWorkspaceRow(slug);

    if (slug === DEFAULT_WORKSPACE_SLUG) {
      throw new DefaultWorkspaceProtectedError("rename");
    }

    const parsedName = WorkspaceNameSchema.parse(name);
    const conflictingWorkspace = this.getWorkspaceRowByName(parsedName);

    if (conflictingWorkspace && conflictingWorkspace.id !== workspace.id) {
      throw new WorkspaceNameConflictError(parsedName);
    }

    if (workspace.name === parsedName) {
      return toWorkspace(workspace);
    }

    const updatedAt = this.clock().toISOString();
    this.database
      .prepare<[string, string, number]>(
        "UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?",
      )
      .run(parsedName, updatedAt, workspace.id);

    return WorkspaceSchema.parse({
      slug,
      name: parsedName,
      createdAt: workspace.created_at,
      updatedAt,
    });
  }

  deleteWorkspace(slug: string): void {
    const workspace = this.requireWorkspaceRow(slug);

    if (slug === DEFAULT_WORKSPACE_SLUG) {
      throw new DefaultWorkspaceProtectedError("delete");
    }

    const document = this.database
      .prepare<[number], { id: number }>(
        "SELECT id FROM documents WHERE workspace_id = ? LIMIT 1",
      )
      .get(workspace.id);

    if (document) {
      throw new WorkspaceNotEmptyError(slug);
    }

    this.database
      .prepare<[number]>("DELETE FROM workspaces WHERE id = ?")
      .run(workspace.id);
  }

  publishDocument(
    workspaceSlug: string,
    slug: string,
    content: string,
  ): PenaDocument {
    return this.publishDocumentTransaction(workspaceSlug, slug, content);
  }

  getDocument(workspaceSlug: string, slug: string): PenaDocument | null {
    const workspace = this.requireWorkspaceRow(workspaceSlug);
    const row = this.getDocumentRow(workspace.id, slug);
    return row ? toDocument(row) : null;
  }

  listDocuments(
    workspaceSlug: string,
    status: DocumentStatus = "active",
  ): DocumentSummary[] {
    const workspace = this.requireWorkspaceRow(workspaceSlug);
    const statusFilter =
      status === "archived"
        ? "documents.archived_at IS NOT NULL"
        : "documents.archived_at IS NULL";
    const orderColumn =
      status === "archived" ? "documents.archived_at" : "documents.updated_at";
    const rows = this.database
      .prepare<[number], DocumentSummaryRow>(
        `
          SELECT
            workspaces.slug AS workspace_slug,
            documents.slug,
            documents.version,
            documents.updated_at,
            documents.archived_at
          FROM documents
          JOIN workspaces ON workspaces.id = documents.workspace_id
          WHERE documents.workspace_id = ? AND ${statusFilter}
          ORDER BY ${orderColumn} DESC, documents.id DESC
        `,
      )
      .all(workspace.id);

    return rows.map(toDocumentSummary);
  }

  archiveDocument(workspaceSlug: string, slug: string): DocumentSummary {
    const document = this.requireDocumentRow(workspaceSlug, slug);

    if (document.archived_at !== null) {
      return toDocumentSummary(document);
    }

    const archivedAt = this.clock().toISOString();
    this.database
      .prepare<[string, number]>(
        "UPDATE documents SET archived_at = ? WHERE id = ?",
      )
      .run(archivedAt, document.id);

    return DocumentSummarySchema.parse({
      workspaceSlug,
      slug: document.slug,
      version: document.version,
      updatedAt: document.updated_at,
      archivedAt,
    });
  }

  restoreDocument(workspaceSlug: string, slug: string): DocumentSummary {
    const document = this.requireDocumentRow(workspaceSlug, slug);

    if (document.archived_at === null) {
      return toDocumentSummary(document);
    }

    this.database
      .prepare<[number]>(
        "UPDATE documents SET archived_at = NULL WHERE id = ?",
      )
      .run(document.id);

    return DocumentSummarySchema.parse({
      workspaceSlug,
      slug: document.slug,
      version: document.version,
      updatedAt: document.updated_at,
      archivedAt: null,
    });
  }

  deleteArchivedDocument(workspaceSlug: string, slug: string): void {
    const document = this.requireDocumentRow(workspaceSlug, slug);

    if (document.archived_at === null) {
      throw new DocumentNotArchivedError(workspaceSlug, slug);
    }

    this.database
      .prepare<[number]>("DELETE FROM documents WHERE id = ?")
      .run(document.id);
  }

  addFeedback(
    workspaceSlug: string,
    slug: string,
    submission: FeedbackSubmission,
  ): FeedbackBatch {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    const validatedSubmission = FeedbackSubmissionSchema.parse(submission);
    const submittedAt = this.clock().toISOString();
    const result = this.database
      .prepare<[number, string, string]>(
        `
          INSERT INTO feedback_batches (
            document_id,
            submitted_at,
            comments_json
          )
          VALUES (?, ?, ?)
        `,
      )
      .run(
        document.id,
        submittedAt,
        JSON.stringify(validatedSubmission.comments),
      );

    return FeedbackBatchSchema.parse({
      id: Number(result.lastInsertRowid),
      submittedAt,
      comments: validatedSubmission.comments,
    });
  }

  getFeedback(workspaceSlug: string, slug: string): FeedbackResponse {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    const rows = this.database
      .prepare<[number], FeedbackBatchRow>(
        `
          SELECT id, submitted_at, comments_json
          FROM feedback_batches
          WHERE document_id = ?
          ORDER BY id ASC
        `,
      )
      .all(document.id);

    const batches = rows.map((row) => parseFeedbackBatch(row));
    return FeedbackResponseSchema.parse({ batches });
  }

  close(): void {
    if (this.database.open) {
      this.database.close();
    }
  }

  private getWorkspaceRow(slug: string): WorkspaceRow | null {
    return (
      this.database
        .prepare<[string], WorkspaceRow>(
          `
            SELECT id, slug, name, created_at, updated_at
            FROM workspaces
            WHERE slug = ?
          `,
        )
        .get(slug) ?? null
    );
  }

  private getWorkspaceRowByName(name: string): WorkspaceRow | null {
    return (
      this.database
        .prepare<[string], WorkspaceRow>(
          `
            SELECT id, slug, name, created_at, updated_at
            FROM workspaces
            WHERE name = ? COLLATE NOCASE
          `,
        )
        .get(name) ?? null
    );
  }

  private requireWorkspaceRow(slug: string): WorkspaceRow {
    const workspace = this.getWorkspaceRow(slug);

    if (!workspace) {
      throw new WorkspaceNotFoundError(slug);
    }

    return workspace;
  }

  private getDocumentRow(workspaceId: number, slug: string): DocumentRow | null {
    return (
      this.database
        .prepare<[number, string], DocumentRow>(
          `
            SELECT
              documents.id,
              documents.workspace_id,
              workspaces.slug AS workspace_slug,
              documents.slug,
              documents.content,
              documents.version,
              documents.updated_at,
              documents.archived_at
            FROM documents
            JOIN workspaces ON workspaces.id = documents.workspace_id
            WHERE documents.workspace_id = ? AND documents.slug = ?
          `,
        )
        .get(workspaceId, slug) ?? null
    );
  }

  private requireDocumentRow(
    workspaceSlug: string,
    slug: string,
  ): DocumentRow {
    const workspace = this.requireWorkspaceRow(workspaceSlug);
    const document = this.getDocumentRow(workspace.id, slug);

    if (!document) {
      throw new DocumentNotFoundError(workspaceSlug, slug);
    }

    return document;
  }
}

function configureDatabase(database: Database.Database): void {
  database.pragma(`busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
}

function migrateDatabase(database: Database.Database): void {
  const storedSchemaVersion = database.pragma("user_version", {
    simple: true,
  });

  if (typeof storedSchemaVersion !== "number") {
    throw new Error("Could not read the Pena database schema version.");
  }

  let schemaVersion = storedSchemaVersion;

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(
      schemaVersion,
      CURRENT_SCHEMA_VERSION,
    );
  }

  if (schemaVersion < 1) {
    database.transaction(() => {
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

        PRAGMA user_version = 1;
      `);
    })();
    schemaVersion = 1;
  }

  if (schemaVersion < 2) {
    database.transaction(() => {
      database.exec(`
        ALTER TABLE documents
          ADD COLUMN version INTEGER NOT NULL DEFAULT 1
          CHECK (version >= 1);

        PRAGMA user_version = 2;
      `);
    })();
    schemaVersion = 2;
  }

  if (schemaVersion < 3) {
    database.transaction(() => {
      database.exec(`
        ALTER TABLE documents
          ADD COLUMN archived_at TEXT;

        PRAGMA user_version = 3;
      `);
    })();
    schemaVersion = 3;
  }

  if (schemaVersion < 4) {
    migrateToWorkspaceSchema(database);
  }
}

function migrateToWorkspaceSchema(database: Database.Database): void {
  database.pragma("foreign_keys = OFF");

  try {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE workspaces (
          id         INTEGER PRIMARY KEY,
          slug       TEXT NOT NULL UNIQUE,
          name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO workspaces (
          id,
          slug,
          name,
          created_at,
          updated_at
        )
        VALUES (
          1,
          'default',
          'Default',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );

        ALTER TABLE documents RENAME TO documents_before_workspaces;
        ALTER TABLE feedback_batches RENAME TO feedback_before_workspaces;

        CREATE TABLE documents (
          id           INTEGER PRIMARY KEY,
          workspace_id INTEGER NOT NULL
                       REFERENCES workspaces(id) ON DELETE RESTRICT,
          slug         TEXT NOT NULL,
          content      TEXT NOT NULL,
          updated_at   TEXT NOT NULL,
          version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
          archived_at  TEXT,
          UNIQUE (workspace_id, slug)
        ) STRICT;

        INSERT INTO documents (
          id,
          workspace_id,
          slug,
          content,
          updated_at,
          version,
          archived_at
        )
        SELECT
          id,
          1,
          slug,
          content,
          updated_at,
          version,
          archived_at
        FROM documents_before_workspaces;

        CREATE TABLE feedback_batches (
          id            INTEGER PRIMARY KEY,
          document_id   INTEGER NOT NULL
                        REFERENCES documents(id) ON DELETE CASCADE,
          submitted_at  TEXT NOT NULL,
          comments_json TEXT NOT NULL
        ) STRICT;

        INSERT INTO feedback_batches (
          id,
          document_id,
          submitted_at,
          comments_json
        )
        SELECT id, document_id, submitted_at, comments_json
        FROM feedback_before_workspaces;

        DROP TABLE feedback_before_workspaces;
        DROP TABLE documents_before_workspaces;

        CREATE INDEX feedback_batches_document_id_id
          ON feedback_batches(document_id, id);

        CREATE INDEX documents_workspace_id_archived_at_updated_at
          ON documents(workspace_id, archived_at, updated_at);

        PRAGMA user_version = 4;
      `);
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }

  const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];

  if (foreignKeyViolations.length > 0) {
    throw new Error("The workspace migration produced invalid foreign keys.");
  }
}

function slugifyWorkspaceName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return WorkspaceSchema.parse({
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toWorkspaceSummary(row: WorkspaceSummaryRow): WorkspaceSummary {
  return WorkspaceSummarySchema.parse({
    ...toWorkspace(row),
    documentCount: row.document_count,
  });
}

function toDocument(row: DocumentRow): PenaDocument {
  return DocumentSchema.parse({
    workspaceSlug: row.workspace_slug,
    slug: row.slug,
    content: row.content,
    version: row.version,
    updatedAt: row.updated_at,
  });
}

function toDocumentSummary(row: DocumentSummaryRow): DocumentSummary {
  return DocumentSummarySchema.parse({
    workspaceSlug: row.workspace_slug,
    slug: row.slug,
    version: row.version,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  });
}

function parseFeedbackBatch(row: FeedbackBatchRow): FeedbackBatch {
  let comments: unknown;

  try {
    comments = JSON.parse(row.comments_json);
  } catch (error) {
    throw new PersistedDataError(
      `Feedback batch ${row.id} contains invalid comment JSON.`,
      { cause: error },
    );
  }

  const result = FeedbackBatchSchema.safeParse({
    id: row.id,
    submittedAt: row.submitted_at,
    comments,
  });

  if (!result.success) {
    throw new PersistedDataError(
      `Feedback batch ${row.id} contains invalid persisted data.`,
      { cause: result.error },
    );
  }

  return result.data;
}
