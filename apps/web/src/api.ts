import type {
  DocumentListResponse,
  DocumentSummary,
  DocumentStatus,
  FeedbackBatch,
  FeedbackResponse,
  FeedbackSubmission,
  PenaDocument,
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

export async function fetchDocument(slug: string): Promise<PenaDocument | null> {
  const response = await fetch(`/api/documents/${encodeURIComponent(slug)}`);

  if (response.status === 404) {
    return null;
  }

  return parseResponse<PenaDocument>(response);
}

export async function fetchDocuments(
  status: DocumentStatus = "active",
): Promise<DocumentListResponse> {
  const query = status === "archived" ? "?status=archived" : "";
  const response = await fetch(`/api/documents${query}`);
  return parseResponse<DocumentListResponse>(response);
}

export async function archiveDocument(slug: string): Promise<DocumentSummary> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(slug)}/archive`,
    { method: "POST" },
  );
  return parseResponse<DocumentSummary>(response);
}

export async function restoreDocument(slug: string): Promise<DocumentSummary> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(slug)}/archive`,
    { method: "DELETE" },
  );
  return parseResponse<DocumentSummary>(response);
}

export async function deleteDocument(slug: string): Promise<void> {
  const response = await fetch(`/api/documents/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? `Pena returned HTTP ${response.status}.`);
  }
}

export async function submitFeedback(
  slug: string,
  submission: FeedbackSubmission,
): Promise<FeedbackBatch> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(slug)}/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    },
  );

  return parseResponse<FeedbackBatch>(response);
}

export async function fetchFeedback(slug: string): Promise<FeedbackResponse> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(slug)}/feedback`,
  );

  return parseResponse<FeedbackResponse>(response);
}
