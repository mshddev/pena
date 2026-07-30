import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AssetTooLargeError,
  FileAssetStore,
  MAX_ASSET_BYTES,
  UnsupportedAssetTypeError,
} from "./file-asset-store.js";

const temporaryDirectories = new Set<string>();

function createStore(): FileAssetStore {
  const directory = mkdtempSync(join(tmpdir(), "pena-file-assets-"));
  temporaryDirectories.add(directory);
  return new FileAssetStore(directory);
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("FileAssetStore", () => {
  it.each([
    {
      extension: "png",
      mediaType: "image/png",
      content: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]),
    },
    {
      extension: "jpg",
      mediaType: "image/jpeg",
      content: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
    },
    {
      extension: "webp",
      mediaType: "image/webp",
      content: Buffer.from("RIFF0000WEBP", "ascii"),
    },
    {
      extension: "gif",
      mediaType: "image/gif",
      content: Buffer.from("GIF89a", "ascii"),
    },
  ] as const)("stores and reads $mediaType files", async ({
    content,
    extension,
    mediaType,
  }) => {
    const store = createStore();
    const stored = await store.put(content);
    const resource = await store.get(stored.id);

    expect(stored).toMatchObject({
      created: true,
      id: expect.stringMatching(
        new RegExp(`^[a-f0-9]{64}\\.${extension}$`),
      ),
      mediaType,
      size: content.byteLength,
    });
    expect(resource).toMatchObject({
      mediaType,
      size: content.byteLength,
    });
    expect(readFileSync(resource?.path ?? "")).toEqual(content);
  });

  it("deduplicates identical content", async () => {
    const store = createStore();
    const content = Buffer.from("GIF87a", "ascii");
    const first = await store.put(content);
    const second = await store.put(content);

    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
  });

  it("rejects unsupported and oversized files", async () => {
    const store = createStore();

    await expect(store.put(Buffer.from("<svg></svg>"))).rejects.toBeInstanceOf(
      UnsupportedAssetTypeError,
    );
    await expect(
      store.put(Buffer.alloc(MAX_ASSET_BYTES + 1)),
    ).rejects.toBeInstanceOf(AssetTooLargeError);
  });
});
