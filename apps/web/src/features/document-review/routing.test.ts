import { describe, expect, it } from "vitest";

import {
  archiveHref,
  collectionHref,
  documentHref,
  readAppRoute,
} from "./routing";

describe("routing", () => {
  it("reads home, collection, document, archive, and management routes", () => {
    expect(readAppRoute("/")).toEqual({ kind: "home", collectionSlug: null });
    expect(readAppRoute("/collections")).toEqual({ kind: "collections" });
    expect(readAppRoute("/collections/research")).toEqual({
      kind: "home",
      collectionSlug: "research",
    });
    expect(readAppRoute("/docs/initial-spec")).toEqual({
      kind: "document",
      documentSlug: "initial-spec",
    });
    expect(readAppRoute("/archive")).toEqual({
      kind: "archive",
      collectionSlug: null,
    });
    expect(readAppRoute("/archive", "?collection=research")).toEqual({
      kind: "archive",
      collectionSlug: "research",
    });
  });

  it("rejects retired workspace routes and invalid slugs", () => {
    expect(readAppRoute("/workspaces")).toEqual({ kind: "not-found" });
    expect(readAppRoute("/workspaces/default/documents/initial-spec")).toEqual(
      { kind: "not-found" },
    );
    expect(readAppRoute("/documents/initial-spec")).toEqual({
      kind: "not-found",
    });
    expect(readAppRoute("/docs/Invalid_Name")).toEqual({ kind: "not-found" });
    expect(readAppRoute("/collections/Invalid_Name")).toEqual({
      kind: "not-found",
    });
    expect(readAppRoute("/archive", "?collection=Invalid_Name")).toEqual({
      kind: "not-found",
    });
    expect(readAppRoute("/collections/research/docs/spec")).toEqual({
      kind: "not-found",
    });
  });

  it("builds hrefs that the router reads back", () => {
    expect(documentHref("initial-spec")).toBe("/docs/initial-spec");
    expect(collectionHref(null)).toBe("/");
    expect(collectionHref("research")).toBe("/collections/research");
    expect(archiveHref(null)).toBe("/archive");
    expect(archiveHref("research")).toBe("/archive?collection=research");
  });
});
