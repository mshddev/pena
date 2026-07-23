import type {
  DocumentListResponse,
  DocumentSummary,
  DocumentStatus,
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
): Promise<PenaDocument | null> {
  const response = await fetch(documentUrl(workspaceSlug, documentSlug));

  if (response.status === 404) {
    return null;
  }

  return parseResponse<PenaDocument>(response);
}

export async function fetchDocuments(
  workspaceSlug: string,
  status: DocumentStatus = "active",
): Promise<DocumentListResponse> {
  const query = status === "archived" ? "?status=archived" : "";
  const response = await fetch(`${documentsUrl(workspaceSlug)}${query}`);
  return parseResponse<DocumentListResponse>(response);
}

async function updateDocumentStatus(
  workspaceSlug: string,
  documentSlug: string,
  status: DocumentStatus,
): Promise<DocumentSummary> {
  const response = await fetch(documentUrl(workspaceSlug, documentSlug), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return parseResponse<DocumentSummary>(response);
}

export async function archiveDocument(
  workspaceSlug: string,
  documentSlug: string,
): Promise<DocumentSummary> {
  return updateDocumentStatus(workspaceSlug, documentSlug, "archived");
}

export async function restoreDocument(
  workspaceSlug: string,
  documentSlug: string,
): Promise<DocumentSummary> {
  return updateDocumentStatus(workspaceSlug, documentSlug, "active");
}

export async function deleteDocument(
  workspaceSlug: string,
  documentSlug: string,
): Promise<void> {
  const response = await fetch(documentUrl(workspaceSlug, documentSlug), {
    method: "DELETE",
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
): Promise<FeedbackBatch> {
  const response = await fetch(
    `${documentUrl(workspaceSlug, documentSlug)}/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
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
