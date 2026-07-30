import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

const ASSET_ID_PATTERN =
  /^(?<digest>[a-f0-9]{64})\.(?<extension>png|jpg|webp|gif)$/;

export type AssetMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

export interface StoredAsset {
  created: boolean;
  id: string;
  mediaType: AssetMediaType;
  size: number;
  url: string;
}

export interface AssetResource {
  digest: string;
  mediaType: AssetMediaType;
  path: string;
  size: number;
}

export interface AssetStore {
  put(content: Buffer): Promise<StoredAsset>;
  get(id: string): Promise<AssetResource | null>;
}

export class AssetTooLargeError extends Error {
  constructor() {
    super(`Images must not exceed ${MAX_ASSET_BYTES} bytes.`);
    this.name = "AssetTooLargeError";
  }
}

export class UnsupportedAssetTypeError extends Error {
  constructor() {
    super("Images must be PNG, JPEG, WebP, or GIF files.");
    this.name = "UnsupportedAssetTypeError";
  }
}

export class FileAssetStore implements AssetStore {
  constructor(private readonly directory: string) {}

  async put(content: Buffer): Promise<StoredAsset> {
    if (content.byteLength > MAX_ASSET_BYTES) {
      throw new AssetTooLargeError();
    }

    const format = detectImageFormat(content);

    if (!format) {
      throw new UnsupportedAssetTypeError();
    }

    const digest = createHash("sha256").update(content).digest("hex");
    const id = `${digest}.${format.extension}`;
    const path = this.resolveAssetPath(id);
    let created = false;

    try {
      const existing = await lstat(path);

      if (!existing.isFile()) {
        throw new Error(`The Pena asset path "${path}" is not a file.`);
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = join(
        dirname(path),
        `.${id}.${randomUUID()}.tmp`,
      );

      try {
        await writeFile(temporaryPath, content, { flag: "wx" });
        await rename(temporaryPath, path);
        created = true;
      } finally {
        await rm(temporaryPath, { force: true });
      }
    }

    return {
      created,
      id,
      mediaType: format.mediaType,
      size: content.byteLength,
      url: `/api/assets/${id}`,
    };
  }

  async get(id: string): Promise<AssetResource | null> {
    const match = ASSET_ID_PATTERN.exec(id);

    if (!match?.groups) {
      return null;
    }

    const { digest, extension } = match.groups;

    if (!digest || !extension) {
      return null;
    }

    const path = this.resolveAssetPath(id);

    try {
      const file = await lstat(path);

      if (!file.isFile()) {
        return null;
      }

      return {
        digest,
        mediaType: mediaTypeForExtension(extension),
        path,
        size: file.size,
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  private resolveAssetPath(id: string): string {
    return join(this.directory, id.slice(0, 2), id);
  }
}

function detectImageFormat(
  content: Buffer,
): {
  extension: "png" | "jpg" | "webp" | "gif";
  mediaType: AssetMediaType;
} | null {
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return { extension: "png", mediaType: "image/png" };
  }

  if (
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  ) {
    return { extension: "jpg", mediaType: "image/jpeg" };
  }

  if (
    content.length >= 12 &&
    content.toString("ascii", 0, 4) === "RIFF" &&
    content.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { extension: "webp", mediaType: "image/webp" };
  }

  if (
    content.length >= 6 &&
    (content.toString("ascii", 0, 6) === "GIF87a" ||
      content.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return { extension: "gif", mediaType: "image/gif" };
  }

  return null;
}

function mediaTypeForExtension(
  extension: string | undefined,
): AssetMediaType {
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      throw new UnsupportedAssetTypeError();
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
