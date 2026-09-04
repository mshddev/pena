import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import {
  CollectionNameSchema,
  CollectionSchema,
  CollectionSummarySchema,
  DocumentSchema,
  DocumentSummarySchema,
  DocumentVersionSchema,
  DocumentVersionSummarySchema,
  FeedbackBatchSchema,
  FeedbackReceiptSchema,
  FeedbackResponseSchema,
  FeedbackSubmissionSchema,
  type Collection,
  type CollectionSummary,
  type DocumentSummary,
  type DocumentVersion,
  type DocumentVersionSummary,
  type FeedbackBatch,
  type FeedbackReceipt,
  type FeedbackResponse,
  type FeedbackSubmission,
  type PenaDocument,
} from "@pena/contracts";
import Database from "better-sqlite3";

import {
  extractLeadingDocumentTitle,
  readDocumentExcerpt,
} from "./document-preview.js";
import {
  CollectionCycleError,
  CollectionNameConflictError,
  CollectionNameInvalidError,
  CollectionNotEmptyError,
  CollectionNotFoundError,
  CollectionSlugConflictError,
  DocumentArchivedError,
  DocumentNotArchivedError,
  DocumentNotFoundError,
  DocumentPreconditionFailedError,
  DocumentSlugConflictMigrationError,
  ReservedCollectionSlugMigrationError,
  DocumentVersionNotFoundError,
  FeedbackPreconditionFailedError,
  PersistedDataError,
  UnsupportedSchemaVersionError,
  type CollectionUpdate,
  type DocumentListFilter,
  type DocumentPublishOptions,
  type DocumentResource,
  type PenaStore,
} from "./pena-store.js";

const CURRENT_SCHEMA_VERSION = 10;
const RESERVED_COLLECTION_SLUG = "root";
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

interface SqlitePenaStoreOptions {
  clock?: () => Date;
}

interface CollectionRow {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  parent_slug: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionSummaryRow extends CollectionRow {
  document_count: number;
  child_count: number;
}

interface DocumentRow {
  id: number;
  collection_id: number | null;
  collection_slug: string | null;
  slug: string;
  version_id: number;
  title: string;
  content: string;
  version: number;
  updated_at: string;
  archived_at: string | null;
  state_token: string;
}

type DocumentSummaryRow = Omit<
  DocumentRow,
  "id" | "collection_id" | "version_id" | "state_token"
>;

interface DocumentVersionRow {
  collection_slug: string | null;
  slug: string;
  title: string;
  content: string;
  version: number;
  published_at: string;
}

interface FeedbackBatchRow {
  id: number;
  submitted_at: string;
  instruction_text: string | null;
  comments_json: string;
}

type FeedbackReceiptRow = Pick<FeedbackBatchRow, "id" | "submitted_at">;

/** A resolved publish destination: `undefined` keeps the current one. */
type CollectionTarget = CollectionRow | null | undefined;

const DOCUMENT_ROW_SELECT = `
  SELECT
    documents.id,
    documents.collection_id,
    collections.slug AS collection_slug,
    documents.slug,
    current_version.id AS version_id,
    current_version.title,
    current_version.content,
    current_version.version,
    current_version.published_at AS updated_at,
    documents.archived_at,
    documents.state_token
  FROM documents
  LEFT JOIN collections ON collections.id = documents.collection_id
  JOIN document_versions AS current_version
    ON current_version.document_id = documents.id
   AND current_version.version = documents.current_version
`;

const COLLECTION_ROW_SELECT = `
  SELECT
    collections.id,
    collections.slug,
    collections.name,
    collections.parent_id,
    parent.slug AS parent_slug,
    collections.created_at,
    collections.updated_at
  FROM collections
  LEFT JOIN collections AS parent ON parent.id = collections.parent_id
`;

export class SqlitePenaStore implements PenaStore {
  private readonly database: Database.Database;
  private readonly clock: () => Date;
  private readonly publishDocumentTransaction: (
    slug: string,
    title: string,
    content: string,
    options: DocumentPublishOptions,
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
        slug: string,
        title: string,
        content: string,
        {
          condition,
          expectedLatestFeedbackBatchId,
          collectionSlug,
        }: DocumentPublishOptions,
      ): PenaDocument => {
        const target = this.resolveCollectionTarget(collectionSlug);
        const currentDocument = this.getDocumentRow(slug);

        if (!currentDocument) {
          if (condition?.kind === "match") {
            throw new DocumentPreconditionFailedError(0);
          }

          const collection = target ?? null;
          const updatedAt = this.clock().toISOString();
          const result = this.database
            .prepare<[number | null, string, string]>(
              `
                INSERT INTO documents (
                  collection_id,
                  slug,
                  current_version,
                  state_token
                )
                VALUES (?, ?, 1, ?)
              `,
            )
            .run(collection?.id ?? null, slug, randomUUID());
          const documentId = Number(result.lastInsertRowid);
          this.database
            .prepare<[number, string, string, string]>(
              `
                INSERT INTO document_versions (
                  document_id,
                  version,
                  title,
                  content,
                  published_at
                )
                VALUES (?, 1, ?, ?, ?)
              `,
            )
            .run(documentId, title, content, updatedAt);

          return DocumentSchema.parse({
            slug,
            collectionSlug: collection?.slug ?? null,
            title,
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
          throw new DocumentArchivedError(slug);
        }

        this.assertLatestFeedbackBatchId(
          currentDocument,
          expectedLatestFeedbackBatchId,
        );

        const contentChanged =
          currentDocument.title !== title ||
          currentDocument.content !== content;
        const nextCollectionId =
          target === undefined
            ? currentDocument.collection_id
            : (target?.id ?? null);
        const collectionChanged =
          nextCollectionId !== currentDocument.collection_id;

        if (!contentChanged && !collectionChanged) {
          return toDocument(currentDocument);
        }

        const nextVersion = contentChanged
          ? currentDocument.version + 1
          : currentDocument.version;
        const updatedAt = contentChanged
          ? this.clock().toISOString()
          : currentDocument.updated_at;

        if (contentChanged) {
          this.database
            .prepare<[number, number, string, string, string]>(
              `
                INSERT INTO document_versions (
                  document_id,
                  version,
                  title,
                  content,
                  published_at
                )
                VALUES (?, ?, ?, ?, ?)
              `,
            )
            .run(currentDocument.id, nextVersion, title, content, updatedAt);
        }

        const update = this.database
          .prepare<[number, number | null, string, number, string]>(
            `
              UPDATE documents
              SET current_version = ?, collection_id = ?, state_token = ?
              WHERE id = ? AND state_token = ?
            `,
          )
          .run(
            nextVersion,
            nextCollectionId,
            randomUUID(),
            currentDocument.id,
            currentDocument.state_token,
          );

        if (update.changes !== 1) {
          throw new DocumentPreconditionFailedError(currentDocument.version);
        }

        return DocumentSchema.parse({
          slug,
          collectionSlug:
            target === undefined
              ? currentDocument.collection_slug
              : (target?.slug ?? null),
          title,
          content,
          version: nextVersion,
          updatedAt,
          archivedAt: null,
        });
      },
    );
  }

  listCollections(): CollectionSummary[] {
    const rows = this.database
      .prepare<[], CollectionSummaryRow>(
        `
          SELECT
            collections.id,
            collections.slug,
            collections.name,
            collections.parent_id,
            parent.slug AS parent_slug,
            collections.created_at,
            collections.updated_at,
            (
              SELECT COUNT(*)
              FROM documents
              WHERE documents.collection_id = collections.id
            ) AS document_count,
            (
              SELECT COUNT(*)
              FROM collections AS child
              WHERE child.parent_id = collections.id
            ) AS child_count
          FROM collections
          LEFT JOIN collections AS parent ON parent.id = collections.parent_id
          ORDER BY collections.name COLLATE NOCASE, collections.id
        `,
      )
      .all();

    return rows.map(toCollectionSummary);
  }

  createCollection(name: string, parentSlug: string | null = null): Collection {
    const parsedName = CollectionNameSchema.parse(name);
    const slug = slugifyCollectionName(parsedName);

    // "root" is how the document list filter names documents outside every
    // collection, so no collection may claim that slug.
    if (!slug || slug === RESERVED_COLLECTION_SLUG) {
      throw new CollectionNameInvalidError();
    }

    const parent = parentSlug === null ? null : this.requireCollectionRow(parentSlug);

    if (this.getCollectionRow(slug)) {
      throw new CollectionSlugConflictError(slug);
    }

    if (this.getCollectionRowByName(parsedName)) {
      throw new CollectionNameConflictError(parsedName);
    }

    const timestamp = this.clock().toISOString();
    this.database
      .prepare<[string, string, number | null, string, string]>(
        `
          INSERT INTO collections (slug, name, parent_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(slug, parsedName, parent?.id ?? null, timestamp, timestamp);

    return CollectionSchema.parse({
      slug,
      name: parsedName,
      parentSlug: parent?.slug ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  updateCollection(slug: string, update: CollectionUpdate): Collection {
    return this.database.transaction(() => {
      const collection = this.requireCollectionRow(slug);
      let nextName = collection.name;
      let nextParent: CollectionRow | null = collection.parent_id === null
        ? null
        : this.requireCollectionRowById(collection.parent_id);

      if (update.name !== undefined) {
        nextName = CollectionNameSchema.parse(update.name);
        const conflicting = this.getCollectionRowByName(nextName);

        if (conflicting && conflicting.id !== collection.id) {
          throw new CollectionNameConflictError(nextName);
        }
      }

      if (update.parentSlug !== undefined) {
        nextParent =
          update.parentSlug === null
            ? null
            : this.requireCollectionRow(update.parentSlug);
        this.assertNoCycle(collection, nextParent);
      }

      const nextParentId = nextParent?.id ?? null;

      if (
        nextName === collection.name &&
        nextParentId === collection.parent_id
      ) {
        return toCollection(collection);
      }

      const updatedAt = this.clock().toISOString();
      this.database
        .prepare<[string, number | null, string, number]>(
          `
            UPDATE collections
            SET name = ?, parent_id = ?, updated_at = ?
            WHERE id = ?
          `,
        )
        .run(nextName, nextParentId, updatedAt, collection.id);

      return CollectionSchema.parse({
        slug,
        name: nextName,
        parentSlug: nextParent?.slug ?? null,
        createdAt: collection.created_at,
        updatedAt,
      });
    })();
  }

  deleteCollection(slug: string): void {
    const collection = this.requireCollectionRow(slug);
    const occupant = this.database
      .prepare<[number, number], { id: number }>(
        `
          SELECT id FROM documents WHERE collection_id = ?
          UNION ALL
          SELECT id FROM collections WHERE parent_id = ?
          LIMIT 1
        `,
      )
      .get(collection.id, collection.id);

    if (occupant) {
      throw new CollectionNotEmptyError(slug);
    }

    this.database
      .prepare<[number]>("DELETE FROM collections WHERE id = ?")
      .run(collection.id);
  }

  publishDocument(
    slug: string,
    title: string,
    content: string,
    options: DocumentPublishOptions = {},
  ): PenaDocument {
    return this.publishDocumentTransaction(slug, title, content, options);
  }

  getDocument(slug: string): PenaDocument | null {
    const row = this.getDocumentRow(slug);
    return row ? toDocument(row) : null;
  }

  getDocumentResource(slug: string): DocumentResource<PenaDocument> | null {
    const row = this.getDocumentRow(slug);
    return row ? { value: toDocument(row), etag: documentEtag(row) } : null;
  }

  listDocumentVersions(slug: string): DocumentVersionSummary[] {
    const document = this.requireDocumentRow(slug);
    const rows = this.database
      .prepare<[number], DocumentVersionRow>(
        `
          SELECT
            collections.slug AS collection_slug,
            documents.slug,
            document_versions.title,
            document_versions.content,
            document_versions.version,
            document_versions.published_at
          FROM document_versions
          JOIN documents ON documents.id = document_versions.document_id
          LEFT JOIN collections ON collections.id = documents.collection_id
          WHERE document_versions.document_id = ?
          ORDER BY document_versions.version DESC
        `,
      )
      .all(document.id);

    return rows.map(toDocumentVersionSummary);
  }

  getDocumentVersion(slug: string, version: number): DocumentVersion | null {
    const document = this.requireDocumentRow(slug);
    const row = this.getDocumentVersionRow(document.id, version);
    return row ? toDocumentVersion(row) : null;
  }

  restoreDocumentVersion(
    slug: string,
    version: number,
    expectedEtag?: string,
  ): PenaDocument {
    return this.database.transaction(() => {
      const current = this.requireDocumentRow(slug);
      this.assertEtag(current, expectedEtag);

      if (current.archived_at !== null) {
        throw new DocumentArchivedError(slug);
      }

      const historical = this.getDocumentVersionRow(current.id, version);

      if (!historical) {
        throw new DocumentVersionNotFoundError(slug, version);
      }

      if (
        historical.title === current.title &&
        historical.content === current.content
      ) {
        return toDocument(current);
      }

      const nextVersion = current.version + 1;
      const updatedAt = this.clock().toISOString();
      this.database
        .prepare<[number, number, string, string, string]>(
          `
            INSERT INTO document_versions (
              document_id,
              version,
              title,
              content,
              published_at
            )
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(
          current.id,
          nextVersion,
          historical.title,
          historical.content,
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
        .run(nextVersion, randomUUID(), current.id, current.state_token);

      if (update.changes !== 1) {
        throw new DocumentPreconditionFailedError(current.version);
      }

      return DocumentSchema.parse({
        slug,
        collectionSlug: current.collection_slug,
        title: historical.title,
        content: historical.content,
        version: nextVersion,
        updatedAt,
        archivedAt: null,
      });
    })();
  }

  listDocuments({
    status = "active",
    collectionSlug,
  }: DocumentListFilter = {}): DocumentSummary[] {
    const conditions = [
      status === "archived"
        ? "documents.archived_at IS NOT NULL"
        : "documents.archived_at IS NULL",
    ];
    const parameters: number[] = [];

    if (collectionSlug === null) {
      conditions.push("documents.collection_id IS NULL");
    } else if (collectionSlug !== undefined) {
      conditions.push("documents.collection_id = ?");
      parameters.push(this.requireCollectionRow(collectionSlug).id);
    }

    const orderColumn =
      status === "archived"
        ? "documents.archived_at"
        : "current_version.published_at";
    const rows = this.database
      .prepare<number[], DocumentSummaryRow>(
        `
          SELECT
            collections.slug AS collection_slug,
            documents.slug,
            current_version.title,
            current_version.content,
            current_version.version,
            current_version.published_at AS updated_at,
            documents.archived_at
          FROM documents
          LEFT JOIN collections ON collections.id = documents.collection_id
          JOIN document_versions AS current_version
            ON current_version.document_id = documents.id
           AND current_version.version = documents.current_version
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${orderColumn} DESC, documents.id DESC
        `,
      )
      .all(...parameters);

    return rows.map(toDocumentSummary);
  }

  listArchivedDocuments(collectionSlug?: string | null): DocumentSummary[] {
    return this.listDocuments({
      status: "archived",
      ...(collectionSlug === undefined ? {} : { collectionSlug }),
    });
  }

  moveDocument(
    slug: string,
    collectionSlug: string | null,
    expectedEtag?: string,
  ): DocumentSummary {
    const document = this.requireDocumentRow(slug);
    this.assertEtag(document, expectedEtag);

    if (document.archived_at !== null) {
      throw new DocumentArchivedError(slug);
    }

    const destination =
      collectionSlug === null
        ? null
        : this.requireCollectionRow(collectionSlug);

    if ((destination?.id ?? null) === document.collection_id) {
      return toDocumentSummary(document);
    }

    const update = this.database
      .prepare<[number | null, string, number, string]>(
        `
          UPDATE documents
          SET collection_id = ?, state_token = ?
          WHERE id = ? AND state_token = ?
        `,
      )
      .run(
        destination?.id ?? null,
        randomUUID(),
        document.id,
        document.state_token,
      );

    if (update.changes !== 1) {
      throw new DocumentPreconditionFailedError(document.version);
    }

    return toDocumentSummary({
      ...document,
      collection_slug: destination?.slug ?? null,
    });
  }

  archiveDocument(slug: string, expectedEtag?: string): DocumentSummary {
    const document = this.requireDocumentRow(slug);
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

  unarchiveDocument(slug: string, expectedEtag?: string): DocumentSummary {
    const document = this.requireDocumentRow(slug);
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

  deleteArchivedDocument(slug: string, expectedEtag?: string): void {
    const document = this.requireDocumentRow(slug);
    this.assertEtag(document, expectedEtag);

    if (document.archived_at === null) {
      throw new DocumentNotArchivedError(slug);
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
    slug: string,
    submission: FeedbackSubmission,
    expectedEtag?: string,
  ): FeedbackBatch {
    const document = this.requireDocumentRow(slug);
    this.assertEtag(document, expectedEtag);

    if (document.archived_at !== null) {
      throw new DocumentArchivedError(slug);
    }

    const validatedSubmission = FeedbackSubmissionSchema.parse(submission);
    const submittedAt = this.clock().toISOString();
    const result = this.database
      .prepare<[number, string, string | null, string, number, string]>(
        `
          INSERT INTO feedback_batches (
            document_version_id,
            submitted_at,
            instruction_text,
            comments_json
          )
          SELECT ?, ?, ?, ?
          FROM documents
          WHERE id = ? AND state_token = ? AND archived_at IS NULL
        `,
      )
      .run(
        document.version_id,
        submittedAt,
        validatedSubmission.instruction ?? null,
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
      ...(validatedSubmission.instruction === undefined
        ? {}
        : { instruction: validatedSubmission.instruction }),
      comments: validatedSubmission.comments,
    });
  }

  getFeedback(slug: string): FeedbackResponse {
    const document = this.requireDocumentRow(slug);
    const rows = this.database
      .prepare<[number], FeedbackBatchRow>(
        `
          SELECT id, submitted_at, instruction_text, comments_json
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

  listFeedbackReceiptsAfter(slug: string, after: number): FeedbackReceipt[] {
    const document = this.requireDocumentRow(slug);
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

  private resolveCollectionTarget(
    collectionSlug: string | null | undefined,
  ): CollectionTarget {
    if (collectionSlug === undefined) {
      return undefined;
    }

    return collectionSlug === null
      ? null
      : this.requireCollectionRow(collectionSlug);
  }

  private getCollectionRow(slug: string): CollectionRow | null {
    return (
      this.database
        .prepare<[string], CollectionRow>(
          `${COLLECTION_ROW_SELECT} WHERE collections.slug = ?`,
        )
        .get(slug) ?? null
    );
  }

  private getCollectionRowByName(name: string): CollectionRow | null {
    return (
      this.database
        .prepare<[string], CollectionRow>(
          `${COLLECTION_ROW_SELECT} WHERE collections.name = ? COLLATE NOCASE`,
        )
        .get(name) ?? null
    );
  }

  private requireCollectionRow(slug: string): CollectionRow {
    const collection = this.getCollectionRow(slug);

    if (!collection) {
      throw new CollectionNotFoundError(slug);
    }

    return collection;
  }

  private requireCollectionRowById(id: number): CollectionRow {
    const collection = this.database
      .prepare<[number], CollectionRow>(
        `${COLLECTION_ROW_SELECT} WHERE collections.id = ?`,
      )
      .get(id);

    if (!collection) {
      throw new PersistedDataError(
        `Collection ${id} is referenced but does not exist.`,
      );
    }

    return collection;
  }

  /** Walks up from the proposed parent to make sure it is not the collection itself or one of its descendants. */
  private assertNoCycle(
    collection: CollectionRow,
    proposedParent: CollectionRow | null,
  ): void {
    let cursor = proposedParent;

    while (cursor) {
      if (cursor.id === collection.id) {
        throw new CollectionCycleError(collection.slug);
      }

      cursor =
        cursor.parent_id === null
          ? null
          : this.requireCollectionRowById(cursor.parent_id);
    }
  }

  private getDocumentRow(slug: string): DocumentRow | null {
    return (
      this.database
        .prepare<[string], DocumentRow>(
          `${DOCUMENT_ROW_SELECT} WHERE documents.slug = ?`,
        )
        .get(slug) ?? null
    );
  }

  private requireDocumentRow(slug: string): DocumentRow {
    const document = this.getDocumentRow(slug);

    if (!document) {
      throw new DocumentNotFoundError(slug);
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
              collections.slug AS collection_slug,
              documents.slug,
              document_versions.title,
              document_versions.content,
              document_versions.version,
              document_versions.published_at
            FROM document_versions
            JOIN documents ON documents.id = document_versions.document_id
            LEFT JOIN collections ON collections.id = documents.collection_id
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
    schemaVersion = 6;
  }

  if (schemaVersion < 7) {
    migrateToDocumentTitles(database);
    schemaVersion = 7;
  }

  if (schemaVersion < 8) {
    migrateLegacyTitlesOutOfContent(database);
    schemaVersion = 8;
  }

  if (schemaVersion < 9) {
    migrateToFeedbackInstructions(database);
    schemaVersion = 9;
  }

  if (schemaVersion < 10) {
    migrateToCollections(database);
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

function migrateToDocumentTitles(database: Database.Database): void {
  database.transaction(() => {
    database.exec(`
      ALTER TABLE document_versions
        ADD COLUMN title TEXT NOT NULL DEFAULT '';
    `);

    const documents = database
      .prepare<[], { id: number; slug: string }>(
        "SELECT id, slug FROM documents",
      )
      .all();
    const updateTitle = database.prepare<[string, number]>(
      "UPDATE document_versions SET title = ? WHERE document_id = ?",
    );

    for (const document of documents) {
      updateTitle.run(formatDocumentSlug(document.slug), document.id);
    }

    database.pragma("user_version = 7");
  })();
}

function migrateLegacyTitlesOutOfContent(database: Database.Database): void {
  database.transaction(() => {
    const versions = database
      .prepare<
        [],
        {
          id: number;
          document_id: number;
          content: string;
        }
      >(
        `
          SELECT id, document_id, content
          FROM document_versions
        `,
      )
      .all();
    const updateVersion = database.prepare<[string, string, number]>(
      `
        UPDATE document_versions
        SET title = ?, content = ?
        WHERE id = ?
      `,
    );
    const changedDocumentIds = new Set<number>();

    for (const version of versions) {
      const extracted = extractLeadingDocumentTitle(version.content);

      if (extracted.title === null) {
        continue;
      }

      updateVersion.run(extracted.title, extracted.content, version.id);
      changedDocumentIds.add(version.document_id);
    }

    const rotateStateToken = database.prepare<[number]>(
      `
        UPDATE documents
        SET state_token = lower(hex(randomblob(16)))
        WHERE id = ?
      `,
    );

    for (const documentId of changedDocumentIds) {
      rotateStateToken.run(documentId);
    }

    database.pragma("user_version = 8");
  })();
}

function migrateToFeedbackInstructions(database: Database.Database): void {
  const columns = database.pragma("table_info(feedback_batches)") as Array<{
    name: string;
  }>;

  database.transaction(() => {
    if (!columns.some(({ name }) => name === "instruction_text")) {
      database.exec(
        "ALTER TABLE feedback_batches ADD COLUMN instruction_text TEXT;",
      );
    }

    database.pragma("user_version = 9");
  })();
}

function formatDocumentSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}


function migrateToCollections(database: Database.Database): void {
  const duplicateSlugs = database
    .prepare<[], { slug: string }>(
      `
        SELECT slug
        FROM documents
        GROUP BY slug
        HAVING COUNT(*) > 1
        ORDER BY slug
      `,
    )
    .all()
    .map((row) => row.slug);

  if (duplicateSlugs.length > 0) {
    throw new DocumentSlugConflictMigrationError(duplicateSlugs);
  }

  // The old workspace layer accepted any non-empty slug, but "root" is how
  // the document list names documents outside every collection.
  const reservedWorkspace = database
    .prepare<[string], { slug: string }>(
      "SELECT slug FROM workspaces WHERE slug = ?",
    )
    .get(RESERVED_COLLECTION_SLUG);

  if (reservedWorkspace) {
    throw new ReservedCollectionSlugMigrationError(RESERVED_COLLECTION_SLUG);
  }

  database.pragma("foreign_keys = OFF");

  try {
    database.transaction(() => {
      // Every workspace except "default" becomes a root collection with the
      // same identity. Documents from "default" move to the root, which is
      // where a document without a collection lives.
      database.exec(`
        CREATE TABLE collections (
          id         INTEGER PRIMARY KEY,
          slug       TEXT NOT NULL UNIQUE,
          name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
          parent_id  INTEGER REFERENCES collections(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO collections (id, slug, name, parent_id, created_at, updated_at)
        SELECT id, slug, name, NULL, created_at, updated_at
        FROM workspaces
        WHERE slug <> 'default';

        CREATE INDEX collections_parent_id ON collections(parent_id);

        CREATE TABLE documents_with_collections (
          id               INTEGER PRIMARY KEY,
          collection_id    INTEGER
                           REFERENCES collections(id) ON DELETE RESTRICT,
          slug             TEXT NOT NULL UNIQUE,
          current_version  INTEGER NOT NULL CHECK (current_version >= 1),
          archived_at      TEXT,
          state_token      TEXT NOT NULL
        ) STRICT;

        INSERT INTO documents_with_collections (
          id,
          collection_id,
          slug,
          current_version,
          archived_at,
          state_token
        )
        SELECT
          documents.id,
          collections.id,
          documents.slug,
          documents.current_version,
          documents.archived_at,
          CASE
            WHEN collections.id IS NULL THEN lower(hex(randomblob(16)))
            ELSE documents.state_token
          END
        FROM documents
        LEFT JOIN collections ON collections.id = documents.workspace_id;

        DROP TABLE documents;
        ALTER TABLE documents_with_collections RENAME TO documents;
        DROP TABLE workspaces;

        CREATE INDEX documents_collection_id_archived_at
          ON documents(collection_id, archived_at);

        PRAGMA user_version = 10;
      `);
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }

  const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];

  if (foreignKeyViolations.length > 0) {
    throw new Error("The collections migration produced invalid foreign keys.");
  }
}

function slugifyCollectionName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function toCollection(row: CollectionRow): Collection {
  return CollectionSchema.parse({
    slug: row.slug,
    name: row.name,
    parentSlug: row.parent_slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toCollectionSummary(row: CollectionSummaryRow): CollectionSummary {
  return CollectionSummarySchema.parse({
    ...toCollection(row),
    documentCount: row.document_count,
    childCount: row.child_count,
  });
}

function toDocument(row: DocumentRow): PenaDocument {
  return DocumentSchema.parse({
    slug: row.slug,
    collectionSlug: row.collection_slug,
    title: row.title,
    content: row.content,
    version: row.version,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  });
}

function toDocumentVersion(row: DocumentVersionRow): DocumentVersion {
  return DocumentVersionSchema.parse({
    slug: row.slug,
    collectionSlug: row.collection_slug,
    title: row.title,
    content: row.content,
    version: row.version,
    updatedAt: row.published_at,
  });
}

function toDocumentVersionSummary(
  row: DocumentVersionRow,
): DocumentVersionSummary {
  return DocumentVersionSummarySchema.parse({
    slug: row.slug,
    collectionSlug: row.collection_slug,
    title: row.title,
    version: row.version,
    updatedAt: row.published_at,
  });
}

function documentEtag(row: Pick<DocumentRow, "state_token">): string {
  return `"pena-${row.state_token}"`;
}

function toDocumentSummary(row: DocumentSummaryRow): DocumentSummary {
  return DocumentSummarySchema.parse({
    slug: row.slug,
    collectionSlug: row.collection_slug,
    title: row.title,
    version: row.version,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    // The body stays on the server; only what a listing can show leaves it.
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
    ...(row.instruction_text === null
      ? {}
      : { instruction: row.instruction_text }),
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
