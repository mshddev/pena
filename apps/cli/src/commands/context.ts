import {
  CollectionSlugSchema,
  DocumentSlugSchema,
  DocumentTitleSchema,
} from "@pena/contracts";

import type { OptionValues } from "../args.js";
import type { PenaClient } from "../client.js";
import { usageError } from "../errors.js";
import type { Io } from "../io.js";

export interface CommandContext {
  client: PenaClient;
  baseUrl: string;
  io: Io;
  json: boolean;
  values: OptionValues;
  positionals: string[];
}

/** What a command prints: `data` for --json, `text` for humans. */
export interface CommandResult {
  data: unknown;
  text: string;
}

export type CommandHandler = (
  context: CommandContext,
) => Promise<CommandResult | undefined>;

export function stringOption(
  context: CommandContext,
  name: string,
): string | undefined {
  const value = context.values[name];
  return typeof value === "string" ? value : undefined;
}

export function booleanOption(context: CommandContext, name: string): boolean {
  return context.values[name] === true;
}

export function positional(context: CommandContext, index: number): string {
  const value = context.positionals[index];

  if (value === undefined) {
    throw usageError(`Missing argument ${index + 1}.`);
  }

  return value;
}

export function parseDocumentSlug(value: string): string {
  const parsed = DocumentSlugSchema.safeParse(value);

  if (!parsed.success) {
    throw usageError(
      `The document slug "${value}" is invalid: use lowercase letters, numbers, and single hyphens (at most 64 characters).`,
    );
  }

  return parsed.data;
}

export function parseCollectionSlug(value: string): string {
  const parsed = CollectionSlugSchema.safeParse(value);

  if (!parsed.success) {
    throw usageError(
      `The collection slug "${value}" is invalid: use lowercase letters, numbers, and single hyphens (at most 64 characters).`,
    );
  }

  return parsed.data;
}

/** Parses a collection target where `root` means "no collection". */
export function parseCollectionTarget(value: string): string | null {
  return value === "root" ? null : parseCollectionSlug(value);
}

/**
 * Turns an `--etag` value into an If-Match header value. The server only
 * accepts a quoted strong ETag, and agents often pass the JSON string's
 * content without its surrounding quotes, so a bare value is wrapped.
 */
export function parseEtag(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw usageError("--etag must not be blank.");
  }

  return trimmed.startsWith('"') || trimmed.startsWith("W/")
    ? trimmed
    : `"${trimmed}"`;
}

export function parseDocumentTitle(value: string): string {
  const parsed = DocumentTitleSchema.safeParse(value);

  if (!parsed.success) {
    throw usageError(
      "The document title must be nonblank and contain at most 200 characters.",
    );
  }

  return parsed.data;
}

export function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw usageError(`${label} must be a positive integer.`);
  }

  return parsed;
}

export function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw usageError(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

export function describeCollection(collectionSlug: unknown): string {
  return typeof collectionSlug === "string" ? collectionSlug : "root";
}

export function documentUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/docs/${encodeURIComponent(slug)}`;
}
