import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  DocumentSchema,
  FeedbackBatchSchema,
  FeedbackResponseSchema,
  FeedbackSubmissionSchema,
  type FeedbackBatch,
  type FeedbackResponse,
  type FeedbackSubmission,
  type PenaDocument,
} from "@pena/contracts";
import Database from "better-sqlite3";

import {
  DocumentNotFoundError,
  PersistedDataError,
  UnsupportedSchemaVersionError,
  type PenaStore,
} from "./pena-store.js";

const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

interface SqlitePenaStoreOptions {
  clock?: () => Date;
}

interface DocumentRow {
  id: number;
  slug: string;
  content: string;
  updated_at: string;
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
      (slug: string, content: string): PenaDocument => {
        const currentDocument = this.getDocumentRow(slug);

        if (!currentDocument) {
          const updatedAt = this.clock().toISOString();
          this.database
            .prepare<[string, string, string]>(
              `
                INSERT INTO documents (slug, content, updated_at)
                VALUES (?, ?, ?)
              `,
            )
            .run(slug, content, updatedAt);

          return DocumentSchema.parse({ slug, content, updatedAt });
        }

        if (currentDocument.content === content) {
          return toDocument(currentDocument);
        }

        const updatedAt = this.clock().toISOString();

        this.database
          .prepare<[number]>(
            "DELETE FROM feedback_batches WHERE document_id = ?",
          )
          .run(currentDocument.id);
        this.database
          .prepare<[string, string, number]>(
            `
              UPDATE documents
              SET content = ?, updated_at = ?
              WHERE id = ?
            `,
          )
          .run(content, updatedAt, currentDocument.id);

        return DocumentSchema.parse({ slug, content, updatedAt });
      },
    );
  }

  publishDocument(slug: string, content: string): PenaDocument {
    return this.publishDocumentTransaction(slug, content);
  }

  getDocument(slug: string): PenaDocument | null {
    const row = this.getDocumentRow(slug);
    return row ? toDocument(row) : null;
  }

  addFeedback(
    slug: string,
    submission: FeedbackSubmission,
  ): FeedbackBatch {
    const document = this.getDocumentRow(slug);

    if (!document) {
      throw new DocumentNotFoundError(slug);
    }

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

  getFeedback(slug: string): FeedbackResponse {
    const document = this.getDocumentRow(slug);

    if (!document) {
      throw new DocumentNotFoundError(slug);
    }

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

  private getDocumentRow(slug: string): DocumentRow | null {
    return (
      this.database
        .prepare<[string], DocumentRow>(
          `
            SELECT id, slug, content, updated_at
            FROM documents
            WHERE slug = ?
          `,
        )
        .get(slug) ?? null
    );
  }
}

function configureDatabase(database: Database.Database): void {
  database.pragma(`busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
}

function migrateDatabase(database: Database.Database): void {
  const schemaVersion = database.pragma("user_version", {
    simple: true,
  });

  if (typeof schemaVersion !== "number") {
    throw new Error("Could not read the Pena database schema version.");
  }

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
  }
}

function toDocument(row: DocumentRow): PenaDocument {
  return DocumentSchema.parse({
    slug: row.slug,
    content: row.content,
    updatedAt: row.updated_at,
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
