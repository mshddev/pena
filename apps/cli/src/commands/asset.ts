import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import type { PenaClient } from "../client.js";
import { errorMessage, usageError } from "../errors.js";
import { positional, type CommandHandler } from "./context.js";

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface UploadedAsset {
  id: string;
  mediaType: string;
  size: number;
  url: string;
}

/** Uploads one local image; usage errors for unreadable or unsupported files. */
export async function uploadImageFile(
  client: PenaClient,
  path: string,
): Promise<UploadedAsset> {
  const extension = extname(path).toLowerCase();
  const mediaType = MEDIA_TYPES[extension];

  if (!mediaType) {
    throw usageError(
      `The image "${path}" has an unsupported type; use a PNG, JPEG, WebP, or GIF file.`,
    );
  }

  let bytes: Buffer;

  try {
    bytes = await readFile(path);
  } catch (error) {
    throw usageError(
      `Could not read the image "${path}": ${errorMessage(error)}`,
    );
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mediaType }),
    basename(path),
  );

  const response = await client.expect("POST", "/api/assets", { form });
  return response.body as UploadedAsset;
}

export const assetUpload: CommandHandler = async (context) => {
  const path = resolve(context.io.cwd, positional(context, 0));
  const asset = await uploadImageFile(context.client, path);

  return { data: asset, text: asset.url };
};
