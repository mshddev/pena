import type { CollectionSummary } from "@pena/contracts";

import { usageError } from "../errors.js";
import {
  describeCollection,
  parseCollectionSlug,
  positional,
  stringOption,
  type CommandHandler,
} from "./context.js";

function collectionPath(slug: string): string {
  return `/api/collections/${encodeURIComponent(slug)}`;
}

function parseCollectionName(value: string): string {
  const name = value.trim();

  if (name.length === 0 || name.length > 80) {
    throw usageError(
      "The collection name must be nonblank and contain at most 80 characters.",
    );
  }

  return name;
}

export const collectionList: CommandHandler = async (context) => {
  const response = await context.client.expect("GET", "/api/collections");
  const body = response.body as { collections: CollectionSummary[] };
  const lines = body.collections.map(
    (collection) =>
      `${collection.slug}\t${collection.name}\tparent=${describeCollection(collection.parentSlug)}\tdocuments=${collection.documentCount}\tchildren=${collection.childCount}`,
  );

  return {
    data: body,
    text: lines.length > 0 ? lines.join("\n") : "No collections.",
  };
};

export const collectionCreate: CommandHandler = async (context) => {
  const name = parseCollectionName(positional(context, 0));
  const parentOption = stringOption(context, "parent");
  const parentSlug =
    parentOption === undefined ? null : parseCollectionSlug(parentOption);
  const response = await context.client.expect("POST", "/api/collections", {
    json: { name, parentSlug },
  });
  const collection = response.body as CollectionSummary;

  return {
    data: collection,
    text: `Created collection "${collection.name}" (${collection.slug}) in ${describeCollection(collection.parentSlug)}.`,
  };
};

export const collectionRename: CommandHandler = async (context) => {
  const slug = parseCollectionSlug(positional(context, 0));
  const name = parseCollectionName(positional(context, 1));
  const response = await context.client.expect("PATCH", collectionPath(slug), {
    json: { name },
  });
  const collection = response.body as CollectionSummary;

  return {
    data: collection,
    text: `Renamed collection ${collection.slug} to "${collection.name}".`,
  };
};

export const collectionDelete: CommandHandler = async (context) => {
  const slug = parseCollectionSlug(positional(context, 0));
  await context.client.expect("DELETE", collectionPath(slug));

  return {
    data: { deleted: true, slug },
    text: `Deleted collection ${slug}.`,
  };
};
