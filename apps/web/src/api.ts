import type {
  DocumentListResponse,
  DocumentSummary,
  DocumentStatus,
  DocumentVersion,
  DocumentVersionListResponse,
  FeedbackBatch,
  FeedbackResponse,
  FeedbackSubmission,
  PenaDocument,
  Workspace,
  WorkspaceListResponse,
} from "@pena/contracts";

interface ApiErrorBody {
  error?: string;
}

export interface DocumentResource {
  document: PenaDocument;
  etag: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? `Pena returned HTTP ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function documentsUrl(workspaceSlug: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceSlug)}/documents`;
}

function documentUrl(workspaceSlug: string, documentSlug: string): string {
  return `${documentsUrl(workspaceSlug)}/${encodeURIComponent(documentSlug)}`;
}

export async function fetchWorkspaces(): Promise<WorkspaceListResponse> {
  const response = await fetch("/api/workspaces");
  return parseResponse<WorkspaceListResponse>(response);
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const response = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseResponse<Workspace>(response);
}

export async function renameWorkspace(
  workspaceSlug: string,
  name: string,
): Promise<Workspace> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  return parseResponse<Workspace>(response);
}

export async function deleteWorkspace(workspaceSlug: string): Promise<void> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? `Pena returned HTTP ${response.status}.`);
  }
}

export async function fetchDocument(
  workspaceSlug: string,
  documentSlug: string,
): Promise<DocumentResource | null> {
  const response = await fetch(documentUrl(workspaceSlug, documentSlug));

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
  workspaceSlug: string,
  documentSlug: string,
): Promise<DocumentVersionListResponse> {
  const response = await fetch(
    `${documentUrl(workspaceSlug, documentSlug)}/versions`,
  );
  return parseResponse<DocumentVersionListResponse>(response);
}

export async function fetchDocumentVersion(
  workspaceSlug: string,
  documentSlug: string,
  version: number,
): Promise<DocumentVersion> {
  const response = await fetch(
    `${documentUrl(workspaceSlug, documentSlug)}/versions/${version}`,
  );
  return parseResponse<DocumentVersion>(response);
}

export async function restoreDocumentVersion(
  workspaceSlug: string,
  documentSlug: string,
  version: number,
  etag: string,
): Promise<DocumentResource> {
  const response = await fetch(
    `${documentUrl(workspaceSlug, documentSlug)}/versions/${version}/restore`,
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
  workspaceSlug: string,
  status: DocumentStatus = "active",
): Promise<DocumentListResponse> {
  const query = status === "archived" ? "?status=archived" : "";
  const response = await fetch(`${documentsUrl(workspaceSlug)}${query}`);
  return parseResponse<DocumentListResponse>(response);
}

export async function fetchArchive(
  workspaceSlug: string | null = null,
): Promise<DocumentListResponse> {
  const query = workspaceSlug
    ? `?workspace=${encodeURIComponent(workspaceSlug)}`
    : "";
  const response = await fetch(`/api/archive${query}`);
  return parseResponse<DocumentListResponse>(response);
}

async function updateDocumentStatus(
  workspaceSlug: string,
  documentSlug: string,
  status: DocumentStatus,
  etag: string,
): Promise<DocumentSummary> {
  const response = await fetch(documentUrl(workspaceSlug, documentSlug), {
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
  workspaceSlug: string,
  documentSlug: string,
  etag: string,
): Promise<DocumentSummary> {
  return updateDocumentStatus(workspaceSlug, documentSlug, "archived", etag);
}

export async function unarchiveDocument(
  workspaceSlug: string,
  documentSlug: string,
  etag: string,
): Promise<DocumentSummary> {
  return updateDocumentStatus(workspaceSlug, documentSlug, "active", etag);
}

export async function moveDocument(
  workspaceSlug: string,
  documentSlug: string,
  destinationWorkspaceSlug: string,
  etag: string,
): Promise<DocumentSummary> {
  const response = await fetch(
    `${documentUrl(workspaceSlug, documentSlug)}/move`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": etag,
      },
      body: JSON.stringify({ workspaceSlug: destinationWorkspaceSlug }),
    },
  );
  return parseResponse<DocumentSummary>(response);
}

export async function deleteDocument(
  workspaceSlug: string,
  documentSlug: string,
  etag: string,
): Promise<void> {
  const response = await fetch(documentUrl(workspaceSlug, documentSlug), {
    method: "DELETE",
    headers: { "if-match": etag },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? `Pena returned HTTP ${response.status}.`);
  }
}

export async function submitFeedback(
  workspaceSlug: string,
  documentSlug: string,
  submission: FeedbackSubmission,
  etag: string,
): Promise<FeedbackBatch> {
  const response = await fetch(
    `${documentUrl(workspaceSlug, documentSlug)}/feedback`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": etag,
      },
      body: JSON.stringify(submission),
    },
  );

  return parseResponse<FeedbackBatch>(response);
}

export async function fetchFeedback(
  workspaceSlug: string,
  documentSlug: string,
): Promise<FeedbackResponse> {
  const response = await fetch(
    `${documentUrl(workspaceSlug, documentSlug)}/feedback`,
  );
  return parseResponse<FeedbackResponse>(response);
}
