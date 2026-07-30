import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import {
  DocumentSchema,
  DocumentSummarySchema,
  DocumentVersionSchema,
  DocumentVersionSummarySchema,
  FeedbackBatchSchema,
  FeedbackReceiptSchema,
  FeedbackResponseSchema,
  FeedbackSubmissionSchema,
  WorkspaceNameSchema,
  WorkspaceSchema,
  WorkspaceSummarySchema,
  type DocumentSummary,
  type DocumentStatus,
  type DocumentVersion,
  type DocumentVersionSummary,
  type FeedbackBatch,
  type FeedbackReceipt,
  type FeedbackResponse,
  type FeedbackSubmission,
  type PenaDocument,
  type Workspace,
  type WorkspaceSummary,
} from "@pena/contracts";
import Database from "better-sqlite3";

import {
  readDocumentExcerpt,
  readDocumentHeading,
} from "./document-preview.js";
import {
  DefaultWorkspaceProtectedError,
  DocumentArchivedError,
  DocumentNotArchivedError,
  DocumentNotFoundError,
  DocumentPreconditionFailedError,
  DocumentSlugConflictError,
  DocumentVersionNotFoundError,
  FeedbackPreconditionFailedError,
  PersistedDataError,
  UnsupportedSchemaVersionError,
  WorkspaceNameConflictError,
  WorkspaceNameInvalidError,
  WorkspaceNotEmptyError,
  WorkspaceNotFoundError,
  WorkspaceSlugConflictError,
  type DocumentResource,
  type DocumentWriteCondition,
  type PenaStore,
} from "./pena-store.js";

export const DEFAULT_WORKSPACE_SLUG = "default";

const CURRENT_SCHEMA_VERSION = 6;
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
  version_id: number;
  content: string;
  version: number;
  updated_at: string;
  archived_at: string | null;
  state_token: string;
}

type DocumentSummaryRow = Omit<
  DocumentRow,
  "id" | "workspace_id" | "version_id" | "state_token"
>;

interface DocumentVersionRow {
  workspace_slug: string;
  slug: string;
  content: string;
  version: number;
  published_at: string;
}

interface FeedbackBatchRow {
  id: number;
  submitted_at: string;
  comments_json: string;
}

type FeedbackReceiptRow = Omit<FeedbackBatchRow, "comments_json">;

export class SqlitePenaStore implements PenaStore {
  private readonly database: Database.Database;
  private readonly clock: () => Date;
  private readonly publishDocumentTransaction: (
    workspaceSlug: string,
    slug: string,
    content: string,
    condition?: DocumentWriteCondition,
    expectedLatestFeedbackBatchId?: number,
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
        condition?: DocumentWriteCondition,
        expectedLatestFeedbackBatchId?: number,
      ): PenaDocument => {
        const workspace = this.requireWorkspaceRow(workspaceSlug);
        const currentDocument = this.getDocumentRow(workspace.id, slug);

        if (!currentDocument) {
          if (condition?.kind === "match") {
            throw new DocumentPreconditionFailedError(0);
          }

          const updatedAt = this.clock().toISOString();
          const result = this.database
            .prepare<[number, string, string]>(
              `
                INSERT INTO documents (
                  workspace_id,
                  slug,
                  current_version,
                  state_token
                )
                VALUES (?, ?, 1, ?)
              `,
            )
            .run(workspace.id, slug, randomUUID());
          const documentId = Number(result.lastInsertRowid);
          this.database
            .prepare<[number, string, string]>(
              `
                INSERT INTO document_versions (
                  document_id,
                  version,
                  content,
                  published_at
                )
                VALUES (?, 1, ?, ?)
              `,
            )
            .run(documentId, content, updatedAt);

          return DocumentSchema.parse({
            workspaceSlug,
            slug,
            content,
            version: 1,
            updatedAt,
            archivedAt: null,
          });
        }

        if (condition?.kind === "create") {
          throw new DocumentPreconditionFailedError(currentDocument.version);
        }

        this.assertEtag(currentDocument, condition?.etag);

        if (currentDocument.archived_at !== null) {
          throw new DocumentArchivedError(workspaceSlug, slug);
        }

        this.assertLatestFeedbackBatchId(
          currentDocument,
          expectedLatestFeedbackBatchId,
        );

        if (currentDocument.content === content) {
          return toDocument(currentDocument);
        }

        const updatedAt = this.clock().toISOString();
        this.database
          .prepare<[number, number, string, string]>(
            `
              INSERT INTO document_versions (
                document_id,
                version,
                content,
                published_at
              )
              VALUES (?, ?, ?, ?)
            `,
          )
          .run(
            currentDocument.id,
            currentDocument.version + 1,
            content,
            updatedAt,
          );
        const update = this.database
          .prepare<[number, string, number, string]>(
            `
              UPDATE documents
              SET current_version = ?, state_token = ?
              WHERE id = ? AND state_token = ?
            `,
          )
          .run(
            currentDocument.version + 1,
            randomUUID(),
            currentDocument.id,
            currentDocument.state_token,
          );

        if (update.changes !== 1) {
          throw new DocumentPreconditionFailedError(currentDocument.version);
        }

        return DocumentSchema.parse({
          workspaceSlug,
          slug,
          content,
          version: currentDocument.version + 1,
          updatedAt,
          archivedAt: null,
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
    condition?: DocumentWriteCondition,
    expectedLatestFeedbackBatchId?: number,
  ): PenaDocument {
    return this.publishDocumentTransaction(
      workspaceSlug,
      slug,
      content,
      condition,
      expectedLatestFeedbackBatchId,
    );
  }

  getDocument(workspaceSlug: string, slug: string): PenaDocument | null {
    const workspace = this.requireWorkspaceRow(workspaceSlug);
    const row = this.getDocumentRow(workspace.id, slug);
    return row ? toDocument(row) : null;
  }

  getDocumentResource(
    workspaceSlug: string,
    slug: string,
  ): DocumentResource<PenaDocument> | null {
    const workspace = this.requireWorkspaceRow(workspaceSlug);
    const row = this.getDocumentRow(workspace.id, slug);
    return row ? { value: toDocument(row), etag: documentEtag(row) } : null;
  }

  listDocumentVersions(
    workspaceSlug: string,
    slug: string,
  ): DocumentVersionSummary[] {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    const rows = this.database
      .prepare<[number], DocumentVersionRow>(
        `
          SELECT
            workspaces.slug AS workspace_slug,
            documents.slug,
            document_versions.content,
            document_versions.version,
            document_versions.published_at
          FROM document_versions
          JOIN documents ON documents.id = document_versions.document_id
          JOIN workspaces ON workspaces.id = documents.workspace_id
          WHERE document_versions.document_id = ?
          ORDER BY document_versions.version DESC
        `,
      )
      .all(document.id);

    return rows.map(toDocumentVersionSummary);
  }

  getDocumentVersion(
    workspaceSlug: string,
    slug: string,
    version: number,
  ): DocumentVersion | null {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    const row = this.getDocumentVersionRow(document.id, version);
    return row ? toDocumentVersion(row) : null;
  }

  restoreDocumentVersion(
    workspaceSlug: string,
    slug: string,
    version: number,
    expectedEtag?: string,
  ): PenaDocument {
    return this.database.transaction(() => {
      const current = this.requireDocumentRow(workspaceSlug, slug);
      this.assertEtag(current, expectedEtag);

      if (current.archived_at !== null) {
        throw new DocumentArchivedError(workspaceSlug, slug);
      }

      const historical = this.getDocumentVersionRow(current.id, version);

      if (!historical) {
        throw new DocumentVersionNotFoundError(workspaceSlug, slug, version);
      }

      if (historical.content === current.content) {
        return toDocument(current);
      }

      const nextVersion = current.version + 1;
      const updatedAt = this.clock().toISOString();
      this.database
        .prepare<[number, number, string, string]>(
          `
            INSERT INTO document_versions (
              document_id,
              version,
              content,
              published_at
            )
            VALUES (?, ?, ?, ?)
          `,
        )
        .run(current.id, nextVersion, historical.content, updatedAt);
      const update = this.database
        .prepare<[number, string, number, string]>(
          `
            UPDATE documents
            SET current_version = ?, state_token = ?
            WHERE id = ? AND state_token = ?
          `,
        )
        .run(nextVersion, randomUUID(), current.id, current.state_token);

      if (update.changes !== 1) {
        throw new DocumentPreconditionFailedError(current.version);
      }

      return DocumentSchema.parse({
        workspaceSlug,
        slug,
        content: historical.content,
        version: nextVersion,
        updatedAt,
        archivedAt: null,
      });
    })();
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
      status === "archived"
        ? "documents.archived_at"
        : "current_version.published_at";
    const rows = this.database
      .prepare<[number], DocumentSummaryRow>(
        `
          SELECT
            workspaces.slug AS workspace_slug,
            documents.slug,
            current_version.content,
            current_version.version,
            current_version.published_at AS updated_at,
            documents.archived_at
          FROM documents
          JOIN workspaces ON workspaces.id = documents.workspace_id
          JOIN document_versions AS current_version
            ON current_version.document_id = documents.id
           AND current_version.version = documents.current_version
          WHERE documents.workspace_id = ? AND ${statusFilter}
          ORDER BY ${orderColumn} DESC, documents.id DESC
        `,
      )
      .all(workspace.id);

    return rows.map(toDocumentSummary);
  }

  listArchivedDocuments(workspaceSlug?: string): DocumentSummary[] {
    const workspace = workspaceSlug
      ? this.requireWorkspaceRow(workspaceSlug)
      : null;
    const rows = workspace
      ? this.database
          .prepare<[number], DocumentSummaryRow>(
            `
              SELECT
                workspaces.slug AS workspace_slug,
                documents.slug,
                current_version.content,
                current_version.version,
                current_version.published_at AS updated_at,
                documents.archived_at
              FROM documents
              JOIN workspaces ON workspaces.id = documents.workspace_id
              JOIN document_versions AS current_version
                ON current_version.document_id = documents.id
               AND current_version.version = documents.current_version
              WHERE documents.workspace_id = ?
                AND documents.archived_at IS NOT NULL
              ORDER BY documents.archived_at DESC, documents.id DESC
            `,
          )
          .all(workspace.id)
      : this.database
          .prepare<[], DocumentSummaryRow>(
            `
              SELECT
                workspaces.slug AS workspace_slug,
                documents.slug,
                current_version.content,
                current_version.version,
                current_version.published_at AS updated_at,
                documents.archived_at
              FROM documents
              JOIN workspaces ON workspaces.id = documents.workspace_id
              JOIN document_versions AS current_version
                ON current_version.document_id = documents.id
               AND current_version.version = documents.current_version
              WHERE documents.archived_at IS NOT NULL
              ORDER BY documents.archived_at DESC, documents.id DESC
            `,
          )
          .all();

    return rows.map(toDocumentSummary);
  }

  moveDocument(
    workspaceSlug: string,
    slug: string,
    destinationWorkspaceSlug: string,
    expectedEtag?: string,
  ): DocumentSummary {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    this.assertEtag(document, expectedEtag);

    if (document.archived_at !== null) {
      throw new DocumentArchivedError(workspaceSlug, slug);
    }

    const destinationWorkspace = this.requireWorkspaceRow(
      destinationWorkspaceSlug,
    );

    if (workspaceSlug === destinationWorkspaceSlug) {
      return toDocumentSummary(document);
    }

    if (this.getDocumentRow(destinationWorkspace.id, slug)) {
      throw new DocumentSlugConflictError(destinationWorkspaceSlug, slug);
    }

    const update = this.database
      .prepare<[number, string, number, string]>(
        `
          UPDATE documents
          SET workspace_id = ?, state_token = ?
          WHERE id = ? AND state_token = ?
        `,
      )
      .run(
        destinationWorkspace.id,
        randomUUID(),
        document.id,
        document.state_token,
      );

    if (update.changes !== 1) {
      throw new DocumentPreconditionFailedError(document.version);
    }

    return toDocumentSummary({
      ...document,
      workspace_slug: destinationWorkspaceSlug,
    });
  }

  archiveDocument(
    workspaceSlug: string,
    slug: string,
    expectedEtag?: string,
  ): DocumentSummary {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    this.assertEtag(document, expectedEtag);

    if (document.archived_at !== null) {
      return toDocumentSummary(document);
    }

    const archivedAt = this.clock().toISOString();
    const update = this.database
      .prepare<[string, string, number, string]>(
        `
          UPDATE documents
          SET archived_at = ?, state_token = ?
          WHERE id = ? AND state_token = ?
        `,
      )
      .run(archivedAt, randomUUID(), document.id, document.state_token);

    if (update.changes !== 1) {
      throw new DocumentPreconditionFailedError(document.version);
    }

    return toDocumentSummary({ ...document, archived_at: archivedAt });
  }

  unarchiveDocument(
    workspaceSlug: string,
    slug: string,
    expectedEtag?: string,
  ): DocumentSummary {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    this.assertEtag(document, expectedEtag);

    if (document.archived_at === null) {
      return toDocumentSummary(document);
    }

    const update = this.database
      .prepare<[string, number, string]>(
        `
          UPDATE documents
          SET archived_at = NULL, state_token = ?
          WHERE id = ? AND state_token = ?
        `,
      )
      .run(randomUUID(), document.id, document.state_token);

    if (update.changes !== 1) {
      throw new DocumentPreconditionFailedError(document.version);
    }

    return toDocumentSummary({ ...document, archived_at: null });
  }

  deleteArchivedDocument(
    workspaceSlug: string,
    slug: string,
    expectedEtag?: string,
  ): void {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    this.assertEtag(document, expectedEtag);

    if (document.archived_at === null) {
      throw new DocumentNotArchivedError(workspaceSlug, slug);
    }

    const deletion = this.database
      .prepare<[number, string]>(
        "DELETE FROM documents WHERE id = ? AND state_token = ?",
      )
      .run(document.id, document.state_token);

    if (deletion.changes !== 1) {
      throw new DocumentPreconditionFailedError(document.version);
    }
  }

  addFeedback(
    workspaceSlug: string,
    slug: string,
    submission: FeedbackSubmission,
    expectedEtag?: string,
  ): FeedbackBatch {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    this.assertEtag(document, expectedEtag);

    if (document.archived_at !== null) {
      throw new DocumentArchivedError(workspaceSlug, slug);
    }

    const validatedSubmission = FeedbackSubmissionSchema.parse(submission);
    const submittedAt = this.clock().toISOString();
    const result = this.database
      .prepare<[number, string, string, number, string]>(
        `
          INSERT INTO feedback_batches (
            document_version_id,
            submitted_at,
            comments_json
          )
          SELECT ?, ?, ?
          FROM documents
          WHERE id = ? AND state_token = ? AND archived_at IS NULL
        `,
      )
      .run(
        document.version_id,
        submittedAt,
        JSON.stringify(validatedSubmission.comments),
        document.id,
        document.state_token,
      );

    if (result.changes !== 1) {
      throw new DocumentPreconditionFailedError(document.version);
    }

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
          WHERE document_version_id = ?
          ORDER BY id ASC
        `,
      )
      .all(document.version_id);

    const batches = rows.map((row) => parseFeedbackBatch(row));
    return FeedbackResponseSchema.parse({
      latestBatchId: batches.at(-1)?.id ?? null,
      batches,
    });
  }

  listFeedbackReceiptsAfter(
    workspaceSlug: string,
    slug: string,
    after: number,
  ): FeedbackReceipt[] {
    const document = this.requireDocumentRow(workspaceSlug, slug);
    const rows = this.database
      .prepare<[number, number], FeedbackReceiptRow>(
        `
          SELECT id, submitted_at
          FROM feedback_batches
          WHERE document_version_id = ? AND id > ?
          ORDER BY id ASC
        `,
      )
      .all(document.version_id, after);

    return rows.map(parseFeedbackReceipt);
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
              current_version.id AS version_id,
              current_version.content,
              current_version.version,
              current_version.published_at AS updated_at,
              documents.archived_at,
              documents.state_token
            FROM documents
            JOIN workspaces ON workspaces.id = documents.workspace_id
            JOIN document_versions AS current_version
              ON current_version.document_id = documents.id
             AND current_version.version = documents.current_version
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

  private getDocumentVersionRow(
    documentId: number,
    version: number,
  ): DocumentVersionRow | null {
    return (
      this.database
        .prepare<[number, number], DocumentVersionRow>(
          `
            SELECT
              workspaces.slug AS workspace_slug,
              documents.slug,
              document_versions.content,
              document_versions.version,
              document_versions.published_at
            FROM document_versions
            JOIN documents ON documents.id = document_versions.document_id
            JOIN workspaces ON workspaces.id = documents.workspace_id
            WHERE document_versions.document_id = ?
              AND document_versions.version = ?
          `,
        )
        .get(documentId, version) ?? null
    );
  }

  private assertEtag(document: DocumentRow, expectedEtag?: string): void {
    if (expectedEtag && expectedEtag !== documentEtag(document)) {
      throw new DocumentPreconditionFailedError(document.version);
    }
  }

  private assertLatestFeedbackBatchId(
    document: DocumentRow,
    expectedLatestFeedbackBatchId?: number,
  ): void {
    if (expectedLatestFeedbackBatchId === undefined) {
      return;
    }

    const row = this.database
      .prepare<[number], { latest_batch_id: number | null }>(
        `
          SELECT MAX(id) AS latest_batch_id
          FROM feedback_batches
          WHERE document_version_id = ?
        `,
      )
      .get(document.version_id);
    const latestBatchId = row?.latest_batch_id ?? null;

    if (expectedLatestFeedbackBatchId !== latestBatchId) {
      throw new FeedbackPreconditionFailedError(
        document.version,
        latestBatchId,
      );
    }
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
    schemaVersion = 4;
  }

  if (schemaVersion < 5) {
    migrateToVersionHistorySchema(database);
    schemaVersion = 5;
  }

  if (schemaVersion < 6) {
    migrateToOpaqueStateToken(database);
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

function migrateToVersionHistorySchema(database: Database.Database): void {
  database.pragma("foreign_keys = OFF");

  try {
    database.transaction(() => {
      database.exec(`
        ALTER TABLE documents RENAME TO documents_before_version_history;
        ALTER TABLE feedback_batches
          RENAME TO feedback_before_version_history;

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

        INSERT INTO documents (
          id,
          workspace_id,
          slug,
          current_version,
          archived_at,
          state_token
        )
        SELECT
          id,
          workspace_id,
          slug,
          version,
          archived_at,
          lower(hex(randomblob(16)))
        FROM documents_before_version_history;

        CREATE TABLE document_versions (
          id           INTEGER PRIMARY KEY,
          document_id  INTEGER NOT NULL
                       REFERENCES documents(id) ON DELETE CASCADE,
          version      INTEGER NOT NULL CHECK (version >= 1),
          content      TEXT NOT NULL,
          published_at TEXT NOT NULL,
          UNIQUE (document_id, version)
        ) STRICT;

        INSERT INTO document_versions (
          document_id,
          version,
          content,
          published_at
        )
        SELECT id, version, content, updated_at
        FROM documents_before_version_history;

        CREATE TABLE feedback_batches (
          id                  INTEGER PRIMARY KEY,
          document_version_id INTEGER NOT NULL
                              REFERENCES document_versions(id)
                              ON DELETE CASCADE,
          submitted_at        TEXT NOT NULL,
          comments_json       TEXT NOT NULL
        ) STRICT;

        INSERT INTO feedback_batches (
          id,
          document_version_id,
          submitted_at,
          comments_json
        )
        SELECT
          feedback_before_version_history.id,
          document_versions.id,
          feedback_before_version_history.submitted_at,
          feedback_before_version_history.comments_json
        FROM feedback_before_version_history
        JOIN documents_before_version_history
          ON documents_before_version_history.id =
             feedback_before_version_history.document_id
        JOIN document_versions
          ON document_versions.document_id =
             documents_before_version_history.id
         AND document_versions.version =
             documents_before_version_history.version;

        DROP TABLE feedback_before_version_history;
        DROP TABLE documents_before_version_history;

        CREATE INDEX document_versions_document_id_version
          ON document_versions(document_id, version);

        CREATE INDEX feedback_batches_document_version_id_id
          ON feedback_batches(document_version_id, id);

        CREATE INDEX documents_workspace_id_archived_at
          ON documents(workspace_id, archived_at);

        PRAGMA user_version = 5;
      `);
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }

  const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];

  if (foreignKeyViolations.length > 0) {
    throw new Error(
      "The version history migration produced invalid foreign keys.",
    );
  }
}

function migrateToOpaqueStateToken(database: Database.Database): void {
  const columns = database.pragma("table_info(documents)") as Array<{
    name: string;
  }>;

  database.transaction(() => {
    if (!columns.some(({ name }) => name === "state_token")) {
      // Early development builds of schema 5 used a numeric state revision.
      // Keep that harmless column in place while adding the opaque token that
      // prevents ETag reuse when a deleted document ID is recycled.
      database.exec(`
        ALTER TABLE documents ADD COLUMN state_token TEXT;

        UPDATE documents
        SET state_token = lower(hex(randomblob(16)));
      `);
    }

    database.pragma("user_version = 6");
  })();
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
    archivedAt: row.archived_at,
  });
}

function toDocumentVersion(row: DocumentVersionRow): DocumentVersion {
  return DocumentVersionSchema.parse({
    workspaceSlug: row.workspace_slug,
    slug: row.slug,
    content: row.content,
    version: row.version,
    updatedAt: row.published_at,
  });
}

function toDocumentVersionSummary(
  row: DocumentVersionRow,
): DocumentVersionSummary {
  return DocumentVersionSummarySchema.parse({
    workspaceSlug: row.workspace_slug,
    slug: row.slug,
    version: row.version,
    updatedAt: row.published_at,
  });
}

function documentEtag(row: Pick<DocumentRow, "state_token">): string {
  return `"pena-${row.state_token}"`;
}

function toDocumentSummary(row: DocumentSummaryRow): DocumentSummary {
  return DocumentSummarySchema.parse({
    workspaceSlug: row.workspace_slug,
    slug: row.slug,
    version: row.version,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    // The body stays on the server; only what a listing can show leaves it.
    heading: readDocumentHeading(row.content),
    excerpt: readDocumentExcerpt(row.content),
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

function parseFeedbackReceipt(row: FeedbackReceiptRow): FeedbackReceipt {
  const result = FeedbackReceiptSchema.safeParse({
    id: row.id,
    submittedAt: row.submitted_at,
  });

  if (!result.success) {
    throw new PersistedDataError(
      `Feedback batch ${row.id} contains invalid persisted data.`,
      { cause: result.error },
    );
  }

  return result.data;
}
