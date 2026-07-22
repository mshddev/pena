import type {
  DocumentSummary,
  FeedbackBatch,
  FeedbackResponse,
  FeedbackSubmission,
  PenaDocument,
} from "@pena/contracts";

export interface PenaStore {
  publishDocument(slug: string, content: string): PenaDocument;
  getDocument(slug: string): PenaDocument | null;
  listDocuments(): DocumentSummary[];
  addFeedback(
    slug: string,
    submission: FeedbackSubmission,
  ): FeedbackBatch;
  getFeedback(slug: string): FeedbackResponse;
  close(): void;
}

export class DocumentNotFoundError extends Error {
  constructor(slug: string) {
    super(`No document has been published with slug "${slug}".`);
    this.name = "DocumentNotFoundError";
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
