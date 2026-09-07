import {
  CliError,
  EXIT_FAILURE,
  EXIT_PRECONDITION,
  errorMessage,
} from "./errors.js";

export interface ApiResponse {
  status: number;
  ok: boolean;
  etag: string | null;
  /** The parsed JSON body, or the raw text when the body is not JSON. */
  body: unknown;
  text: string;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  json?: unknown;
  form?: FormData;
  query?: Record<string, string>;
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8788";

export function resolveBaseUrl(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  const raw = flag ?? env.PENA_URL ?? DEFAULT_BASE_URL;
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new CliError(`The Pena URL "${raw}" is not a valid URL.`, 2);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliError(`The Pena URL "${raw}" must use HTTP or HTTPS.`, 2);
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const cause = error.cause;

  if (cause instanceof AggregateError) {
    return (
      cause.errors.length > 0 &&
      cause.errors.every((entry) => hasCode(entry, "ECONNREFUSED"))
    );
  }

  return hasCode(cause, "ECONNREFUSED");
}

function hasCode(value: unknown, code: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    value.code === code
  );
}

export function networkError(error: unknown, baseUrl: string): CliError {
  if (isConnectionRefused(error)) {
    return new CliError(
      `Pena is not running at ${baseUrl}. Start it with \`pena server start\`.`,
      EXIT_FAILURE,
    );
  }

  return new CliError(
    `Could not reach Pena at ${baseUrl}: ${errorMessage(error)}`,
    EXIT_FAILURE,
  );
}

export function responseError(response: ApiResponse): CliError {
  const body = response.body;
  const message =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : response.text.trim().length > 0
        ? response.text.trim()
        : `Pena returned HTTP ${response.status}.`;

  return new CliError(
    message,
    response.status === 412 ? EXIT_PRECONDITION : EXIT_FAILURE,
    response.status,
  );
}

export class PenaClient {
  constructor(readonly baseUrl: string) {}

  /** Sends a request and returns the response whatever its status; throws only on network errors. */
  async request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse> {
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      ...options.headers,
    };
    let body: string | FormData | undefined;

    if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        cache: "no-store",
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      throw networkError(error, this.baseUrl);
    }

    const text = await response.text();
    let parsed: unknown = text;

    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    } else {
      parsed = null;
    }

    return {
      status: response.status,
      ok: response.ok,
      etag: response.headers.get("etag"),
      body: parsed,
      text,
    };
  }

  /** Like `request`, but turns a non-2xx response into a CliError. */
  async expect(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse> {
    const response = await this.request(method, path, options);

    if (!response.ok) {
      throw responseError(response);
    }

    return response;
  }

  /**
   * Whether a Pena server answers `GET /api/health`; never throws. Any 2xx
   * is not enough: a dev server or static host on the same port answers
   * everything with 200, so the body must be Pena's `{ "status": "ok" }`.
   */
  async isHealthy(timeoutMs = 1_000): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (
        !response.ok ||
        !(response.headers.get("content-type") ?? "").includes(
          "application/json",
        )
      ) {
        return false;
      }

      const body: unknown = await response.json();

      return (
        typeof body === "object" &&
        body !== null &&
        "status" in body &&
        body.status === "ok"
      );
    } catch {
      return false;
    }
  }
}

export function requireEtag(response: ApiResponse): string {
  if (!response.etag) {
    throw new CliError(
      "Pena did not return a document ETag.",
      EXIT_FAILURE,
      response.status,
    );
  }

  return response.etag;
}

export function documentPath(slug: string, suffix = ""): string {
  return `/api/docs/${encodeURIComponent(slug)}${suffix}`;
}
