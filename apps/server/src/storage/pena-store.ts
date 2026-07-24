import type {
  DocumentSummary,
  DocumentStatus,
  FeedbackBatch,
  FeedbackResponse,
  FeedbackSubmission,
  PenaDocument,
  Workspace,
  WorkspaceSummary,
} from "@pena/contracts";

export interface PenaStore {
  listWorkspaces(): WorkspaceSummary[];
  createWorkspace(name: string): Workspace;
  renameWorkspace(slug: string, name: string): Workspace;
  deleteWorkspace(slug: string): void;
  publishDocument(
    workspaceSlug: string,
    slug: string,
    content: string,
  ): PenaDocument;
  getDocument(workspaceSlug: string, slug: string): PenaDocument | null;
  listDocuments(
    workspaceSlug: string,
    status?: DocumentStatus,
  ): DocumentSummary[];
  listArchivedDocuments(workspaceSlug?: string): DocumentSummary[];
  moveDocument(
    workspaceSlug: string,
    slug: string,
    destinationWorkspaceSlug: string,
  ): DocumentSummary;
  archiveDocument(workspaceSlug: string, slug: string): DocumentSummary;
  restoreDocument(workspaceSlug: string, slug: string): DocumentSummary;
  deleteArchivedDocument(workspaceSlug: string, slug: string): void;
  addFeedback(
    workspaceSlug: string,
    slug: string,
    submission: FeedbackSubmission,
  ): FeedbackBatch;
  getFeedback(workspaceSlug: string, slug: string): FeedbackResponse;
  close(): void;
}

export class DocumentNotFoundError extends Error {
  constructor(workspaceSlug: string, slug: string) {
    super(
      `No document has been published with slug "${slug}" in workspace "${workspaceSlug}".`,
    );
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentNotArchivedError extends Error {
  constructor(workspaceSlug: string, slug: string) {
    super(
      `The document "${slug}" in workspace "${workspaceSlug}" must be archived before it can be deleted.`,
    );
    this.name = "DocumentNotArchivedError";
  }
}

export class DocumentArchivedError extends Error {
  constructor(workspaceSlug: string, slug: string) {
    super(
      `The document "${slug}" in workspace "${workspaceSlug}" must be restored before it can be moved.`,
    );
    this.name = "DocumentArchivedError";
  }
}

export class DocumentSlugConflictError extends Error {
  constructor(workspaceSlug: string, slug: string) {
    super(
      `A document with slug "${slug}" already exists in workspace "${workspaceSlug}".`,
    );
    this.name = "DocumentSlugConflictError";
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(slug: string) {
    super(`No workspace exists with slug "${slug}".`);
    this.name = "WorkspaceNotFoundError";
  }
}

export class WorkspaceSlugConflictError extends Error {
  constructor(slug: string) {
    super(`A workspace with slug "${slug}" already exists.`);
    this.name = "WorkspaceSlugConflictError";
  }
}

export class WorkspaceNameInvalidError extends Error {
  constructor() {
    super("The workspace name must contain at least one letter or number.");
    this.name = "WorkspaceNameInvalidError";
  }
}

export class WorkspaceNameConflictError extends Error {
  constructor(name: string) {
    super(`A workspace named "${name}" already exists.`);
    this.name = "WorkspaceNameConflictError";
  }
}

export class DefaultWorkspaceProtectedError extends Error {
  constructor(action: "rename" | "delete") {
    super(`The default workspace cannot be ${action}d.`);
    this.name = "DefaultWorkspaceProtectedError";
  }
}

export class WorkspaceNotEmptyError extends Error {
  constructor(slug: string) {
    super(`The workspace "${slug}" must be empty before it can be deleted.`);
    this.name = "WorkspaceNotEmptyError";
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
