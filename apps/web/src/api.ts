import type {
  FeedbackBatch,
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
