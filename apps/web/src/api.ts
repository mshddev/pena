import type {
  Collection,
  CollectionListResponse,
  CollectionUpdateRequest,
  DocumentListResponse,
  DocumentSummary,
  DocumentStatus,
  DocumentVersion,
  DocumentVersionListResponse,
  FeedbackReceipt,
  FeedbackResponse,
  FeedbackSubmission,
  PenaDocument,
} from "@pena/contracts";

interface ApiErrorBody {
  error?: string;
}

export interface DocumentResource {
  document: PenaDocument;
  etag: string;
}

/** Lists documents at the root (`null`), in one collection, or everywhere. */
export type DocumentListScope = string | null | undefined;

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? `Pena returned HTTP ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

async function assertOk(response: Response): Promise<void> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? `Pena returned HTTP ${response.status}.`);
  }
}

function documentUrl(documentSlug: string): string {
  return `/api/docs/${encodeURIComponent(documentSlug)}`;
}

function collectionUrl(collectionSlug: string): string {
  return `/api/collections/${encodeURIComponent(collectionSlug)}`;
}

export async function fetchCollections(): Promise<CollectionListResponse> {
  const response = await fetch("/api/collections");
  return parseResponse<CollectionListResponse>(response);
}

export async function createCollection(
  name: string,
  parentSlug: string | null = null,
): Promise<Collection> {
  const response = await fetch("/api/collections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, parentSlug }),
  });
  return parseResponse<Collection>(response);
}

export async function updateCollection(
  collectionSlug: string,
  update: CollectionUpdateRequest,
): Promise<Collection> {
  const response = await fetch(collectionUrl(collectionSlug), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  });
  return parseResponse<Collection>(response);
}

export async function deleteCollection(collectionSlug: string): Promise<void> {
  const response = await fetch(collectionUrl(collectionSlug), {
    method: "DELETE",
  });
  await assertOk(response);
}

export async function fetchDocument(
  documentSlug: string,
): Promise<DocumentResource | null> {
  const response = await fetch(documentUrl(documentSlug));

  if (response.status === 404) {
    return null;
  }

  const document = await parseResponse<PenaDocument>(response);
  const etag = response.headers.get("etag");

  if (!etag) {
    throw new Error("Pena did not return a document ETag.");
  }

  return { document, etag };
}

export async function fetchDocumentVersions(
  documentSlug: string,
): Promise<DocumentVersionListResponse> {
  const response = await fetch(`${documentUrl(documentSlug)}/versions`);
  return parseResponse<DocumentVersionListResponse>(response);
}

export async function fetchDocumentVersion(
  documentSlug: string,
  version: number,
): Promise<DocumentVersion> {
  const response = await fetch(
    `${documentUrl(documentSlug)}/versions/${version}`,
  );
  return parseResponse<DocumentVersion>(response);
}

export async function restoreDocumentVersion(
  documentSlug: string,
  version: number,
  etag: string,
): Promise<DocumentResource> {
  const response = await fetch(
    `${documentUrl(documentSlug)}/versions/${version}/restore`,
    {
      method: "POST",
      headers: { "if-match": etag },
    },
  );
  const document = await parseResponse<PenaDocument>(response);
  const nextEtag = response.headers.get("etag");

  if (!nextEtag) {
    throw new Error("Pena did not return a document ETag.");
  }

  return { document, etag: nextEtag };
}

export async function fetchDocuments(
  scope: DocumentListScope = undefined,
  status: DocumentStatus = "active",
): Promise<DocumentListResponse> {
  const query = new URLSearchParams();

  if (status === "archived") {
    query.set("status", "archived");
  }

  if (scope === null) {
    query.set("collection", "root");
  } else if (scope !== undefined) {
    query.set("collection", scope);
  }

  const search = query.toString();
  const response = await fetch(`/api/docs${search ? `?${search}` : ""}`);
  return parseResponse<DocumentListResponse>(response);
}

export async function fetchArchive(
  collectionSlug: string | null = null,
): Promise<DocumentListResponse> {
  const query = collectionSlug
    ? `?collection=${encodeURIComponent(collectionSlug)}`
    : "";
  const response = await fetch(`/api/archive${query}`);
  return parseResponse<DocumentListResponse>(response);
}

async function updateDocumentStatus(
  documentSlug: string,
  status: DocumentStatus,
  etag: string,
): Promise<DocumentSummary> {
  const response = await fetch(documentUrl(documentSlug), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": etag,
    },
    body: JSON.stringify({ status }),
  });
  return parseResponse<DocumentSummary>(response);
}

export async function archiveDocument(
  documentSlug: string,
  etag: string,
): Promise<DocumentSummary> {
  return updateDocumentStatus(documentSlug, "archived", etag);
}

export async function unarchiveDocument(
  documentSlug: string,
  etag: string,
): Promise<DocumentSummary> {
  return updateDocumentStatus(documentSlug, "active", etag);
}

export async function moveDocument(
  documentSlug: string,
  collectionSlug: string | null,
  etag: string,
): Promise<DocumentSummary> {
  const response = await fetch(`${documentUrl(documentSlug)}/move`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "if-match": etag,
    },
    body: JSON.stringify({ collectionSlug }),
  });
  return parseResponse<DocumentSummary>(response);
}

export async function deleteDocument(
  documentSlug: string,
  etag: string,
): Promise<void> {
  const response = await fetch(documentUrl(documentSlug), {
    method: "DELETE",
    headers: { "if-match": etag },
  });
  await assertOk(response);
}

export async function submitFeedback(
  documentSlug: string,
  submission: FeedbackSubmission,
  etag: string,
): Promise<FeedbackReceipt> {
  const response = await fetch(`${documentUrl(documentSlug)}/feedback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "if-match": etag,
    },
    body: JSON.stringify(submission),
  });

  return parseResponse<FeedbackReceipt>(response);
}

export async function fetchFeedback(
  documentSlug: string,
  etag?: string,
): Promise<FeedbackResponse> {
  const response = await fetch(
    `${documentUrl(documentSlug)}/feedback`,
    etag ? { headers: { "if-match": etag } } : undefined,
  );
  return parseResponse<FeedbackResponse>(response);
}
