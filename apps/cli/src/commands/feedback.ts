import type { FeedbackResponse, FeedbackWaitResponse } from "@pena/contracts";

import {
  documentPath,
  requireEtag,
  responseError,
  type ApiResponse,
} from "../client.js";
import {
  CliError,
  EXIT_FAILURE,
  EXIT_TIMEOUT,
  errorMessage,
  usageError,
} from "../errors.js";
import {
  parseDocumentSlug,
  parseEtag,
  parseNonNegativeInteger,
  parsePositiveInteger,
  positional,
  stringOption,
  type CommandHandler,
} from "./context.js";

const DEFAULT_WAIT_TIMEOUT_MS = 25_000;
const MAX_WAIT_TIMEOUT_MS = 30_000;

/** Long-poll settings ported from resources/skills/pena/scripts/watch-feedback.mjs. */
const LONG_POLL_TIMEOUT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_RETRY_DELAY_MS = 5_000;

export const feedbackShow: CommandHandler = async (context) => {
  const slug = parseDocumentSlug(positional(context, 0));
  const etagOption = stringOption(context, "etag");
  const etag =
    etagOption === undefined
      ? requireEtag(await context.client.expect("GET", documentPath(slug)))
      : parseEtag(etagOption);
  const response = await context.client.expect(
    "GET",
    documentPath(slug, "/feedback"),
    { headers: { "if-match": etag } },
  );
  const feedback = response.body as FeedbackResponse;
  const responseEtag = requireEtag(response);
  const lines = [
    `Feedback for ${slug} (ETag ${responseEtag}, latest batch ${feedback.latestBatchId ?? "none"})`,
  ];

  for (const batch of feedback.batches) {
    lines.push("", `Batch ${batch.id} (${batch.submittedAt})`);

    if (batch.instruction !== undefined) {
      lines.push(`  Instruction: ${batch.instruction}`);
    }

    for (const comment of batch.comments) {
      lines.push(
        `  - ${JSON.stringify(comment.selectedText)}: ${comment.comment}`,
      );
    }
  }

  if (feedback.batches.length === 0) {
    lines.push("No feedback yet.");
  }

  return {
    data: { ...feedback, etag: responseEtag },
    text: lines.join("\n"),
  };
};

function parseAfter(context: Parameters<CommandHandler>[0]): number {
  const afterOption = stringOption(context, "after");
  return afterOption === undefined
    ? 0
    : parseNonNegativeInteger(afterOption, "--after");
}

export const feedbackWait: CommandHandler = async (context) => {
  const slug = parseDocumentSlug(positional(context, 0));
  const after = parseAfter(context);
  const timeoutOption = stringOption(context, "timeout");
  const timeout =
    timeoutOption === undefined
      ? DEFAULT_WAIT_TIMEOUT_MS
      : parsePositiveInteger(timeoutOption, "--timeout");

  if (timeout > MAX_WAIT_TIMEOUT_MS) {
    throw usageError(`--timeout must be at most ${MAX_WAIT_TIMEOUT_MS} ms.`);
  }

  let response: ApiResponse;

  try {
    response = await context.client.request(
      "GET",
      documentPath(slug, "/feedback/wait"),
      {
        query: { after: String(after), timeout: String(timeout) },
        signal: context.io.signal,
      },
    );
  } catch (error) {
    if (context.io.signal.aborted) {
      // Cancelled by the user (ctrl-c): nothing to report, exit 0.
      return undefined;
    }

    throw error;
  }

  if (response.status === 204) {
    throw new CliError(
      `No new feedback was submitted for ${slug} within ${timeout} ms.`,
      EXIT_TIMEOUT,
      204,
    );
  }

  if (!response.ok) {
    throw responseError(response);
  }

  return {
    data: response.body,
    text: JSON.stringify(response.body),
  };
};

class TerminalWatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TerminalWatchError";
  }
}

export const feedbackWatch: CommandHandler = async (context) => {
  const slug = parseDocumentSlug(positional(context, 0));
  const { signal, stdout, stderr } = context.io;
  let after = parseAfter(context);
  let retryDelayMs = 250;

  while (!signal.aborted) {
    const url = new URL(
      `${context.baseUrl}${documentPath(slug, "/feedback/wait")}`,
    );
    url.searchParams.set("after", String(after));
    url.searchParams.set("timeout", String(LONG_POLL_TIMEOUT_MS));

    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ]),
      });

      if (response.status === 204) {
        retryDelayMs = 250;
        continue;
      }

      if (!response.ok) {
        const message = await response.text();

        if ([400, 404, 409].includes(response.status)) {
          throw new TerminalWatchError(
            `Pena feedback watch stopped with HTTP ${response.status}: ${message}`,
            response.status,
          );
        }

        throw new Error(
          `Pena feedback wait returned HTTP ${response.status}: ${message}`,
        );
      }

      const event = (await response.json()) as FeedbackWaitResponse;

      if (
        !Number.isSafeInteger(event.latestBatchId) ||
        event.latestBatchId < 1 ||
        event.latestBatchId <= after ||
        !Array.isArray(event.batches) ||
        event.batches.length === 0
      ) {
        throw new Error("Pena returned an invalid feedback wait response.");
      }

      after = event.latestBatchId;
      retryDelayMs = 250;
      stdout.write(
        `${JSON.stringify({
          type: "pena_feedback_submitted",
          documentSlug: event.documentSlug,
          documentVersion: event.documentVersion,
          latestBatchId: event.latestBatchId,
          batchIds: event.batches.map((batch) => batch.id),
        })}\n`,
      );
    } catch (error) {
      if (signal.aborted) {
        break;
      }

      if (error instanceof TerminalWatchError) {
        throw new CliError(error.message, EXIT_FAILURE, error.status);
      }

      stderr.write(
        `Pena feedback watch reconnecting: ${errorMessage(error)}\n`,
      );
      await delay(retryDelayMs, signal);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    }
  }

  return undefined;
};

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
