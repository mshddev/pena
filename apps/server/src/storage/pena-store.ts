import type {
  Collection,
  CollectionSummary,
  DocumentSummary,
  DocumentStatus,
  DocumentVersion,
  DocumentVersionSummary,
  FeedbackBatch,
  FeedbackReceipt,
  FeedbackResponse,
  FeedbackSubmission,
  PenaDocument,
} from "@pena/contracts";

export type DocumentWriteCondition =
  | { kind: "create" }
  | { kind: "match"; etag: string };

export interface DocumentResource<T> {
  etag: string;
  value: T;
}

export interface CollectionUpdate {
  name?: string;
  parentSlug?: string | null;
}

export interface DocumentPublishOptions {
  condition?: DocumentWriteCondition;
  expectedLatestFeedbackBatchId?: number;
  /**
   * Files the document in a collection, or at the root with `null`. Leave it
   * `undefined` to keep an existing document where it is.
   */
  collectionSlug?: string | null;
}

export interface DocumentListFilter {
  status?: DocumentStatus;
  /**
   * `undefined` lists every document, `null` lists the ones at the root, and a
   * slug lists the ones filed directly in that collection.
   */
  collectionSlug?: string | null;
}

export interface PenaStore {
  listCollections(): CollectionSummary[];
  createCollection(name: string, parentSlug?: string | null): Collection;
  updateCollection(slug: string, update: CollectionUpdate): Collection;
  deleteCollection(slug: string): void;
  publishDocument(
    slug: string,
    title: string,
    content: string,
    options?: DocumentPublishOptions,
  ): PenaDocument;
  getDocument(slug: string): PenaDocument | null;
  getDocumentResource(slug: string): DocumentResource<PenaDocument> | null;
  listDocumentVersions(slug: string): DocumentVersionSummary[];
  getDocumentVersion(slug: string, version: number): DocumentVersion | null;
  restoreDocumentVersion(
    slug: string,
    version: number,
    expectedEtag?: string,
  ): PenaDocument;
  listDocuments(filter?: DocumentListFilter): DocumentSummary[];
  /** `undefined` lists every archived document, `null` only those at the root. */
  listArchivedDocuments(collectionSlug?: string | null): DocumentSummary[];
  moveDocument(
    slug: string,
    collectionSlug: string | null,
    expectedEtag?: string,
  ): DocumentSummary;
  archiveDocument(slug: string, expectedEtag?: string): DocumentSummary;
  unarchiveDocument(slug: string, expectedEtag?: string): DocumentSummary;
  deleteArchivedDocument(slug: string, expectedEtag?: string): void;
  addFeedback(
    slug: string,
    submission: FeedbackSubmission,
    expectedEtag?: string,
  ): FeedbackBatch;
  listFeedbackReceiptsAfter(slug: string, after: number): FeedbackReceipt[];
  getFeedback(slug: string): FeedbackResponse;
  close(): void;
}

export class DocumentNotFoundError extends Error {
  constructor(slug: string) {
    super(`No document has been published with slug "${slug}".`);
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentNotArchivedError extends Error {
  constructor(slug: string) {
    super(
      `The document "${slug}" must be archived before it can be deleted.`,
    );
    this.name = "DocumentNotArchivedError";
  }
}

export class DocumentArchivedError extends Error {
  constructor(slug: string) {
    super(
      `The document "${slug}" is archived. Unarchive it before changing or reviewing it.`,
    );
    this.name = "DocumentArchivedError";
  }
}

export class DocumentPreconditionFailedError extends Error {
  constructor(public readonly currentVersion: number) {
    super("The document changed after it was read.");
    this.name = "DocumentPreconditionFailedError";
  }
}

export class FeedbackPreconditionFailedError extends Error {
  constructor(
    public readonly currentVersion: number,
    public readonly latestBatchId: number | null,
  ) {
    super("New feedback was submitted after it was read.");
    this.name = "FeedbackPreconditionFailedError";
  }
}

export class DocumentVersionNotFoundError extends Error {
  constructor(slug: string, version: number) {
    super(`Version ${version} does not exist for document "${slug}".`);
    this.name = "DocumentVersionNotFoundError";
  }
}

export class CollectionNotFoundError extends Error {
  constructor(slug: string) {
    super(`No collection exists with slug "${slug}".`);
    this.name = "CollectionNotFoundError";
  }
}

export class CollectionSlugConflictError extends Error {
  constructor(slug: string) {
    super(
      `A collection with slug "${slug}" already exists. The slug comes from the name, so pick a name that shortens to a different slug.`,
    );
    this.name = "CollectionSlugConflictError";
  }
}

export class CollectionNameInvalidError extends Error {
  constructor() {
    super(
      'The collection name must contain at least one letter or number, and cannot be "root".',
    );
    this.name = "CollectionNameInvalidError";
  }
}

export class CollectionNameConflictError extends Error {
  constructor(name: string) {
    super(`A collection named "${name}" already exists.`);
    this.name = "CollectionNameConflictError";
  }
}

export class CollectionNotEmptyError extends Error {
  constructor(slug: string) {
    super(
      `The collection "${slug}" must contain no documents or collections before it can be deleted.`,
    );
    this.name = "CollectionNotEmptyError";
  }
}

export class CollectionCycleError extends Error {
  constructor(slug: string) {
    super(
      `The collection "${slug}" cannot be moved into itself or one of its descendants.`,
    );
    this.name = "CollectionCycleError";
  }
}

export class PersistedDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistedDataError";
  }
}

export class UnsupportedSchemaVersionError extends Error {
  constructor(actualVersion: number, supportedVersion: number) {
    super(
      `The Pena database uses schema version ${actualVersion}, but this server only supports up to version ${supportedVersion}.`,
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}

export class ReservedCollectionSlugMigrationError extends Error {
  constructor(slug: string) {
    super(
      `A workspace uses the slug "${slug}", which collections reserve for documents outside every collection. Renaming does not change a slug, so change it directly before upgrading: UPDATE workspaces SET slug = 'former-${slug}' WHERE slug = '${slug}';`,
    );
    this.name = "ReservedCollectionSlugMigrationError";
  }
}

export class DocumentSlugConflictMigrationError extends Error {
  constructor(slugs: string[]) {
    super(
      `Document slugs must be unique before collections can replace workspaces, but these slugs exist in more than one workspace: ${slugs.join(", ")}.`,
    );
    this.name = "DocumentSlugConflictMigrationError";
  }
}
