import { describe, expect, it } from "vitest";

import { readAppRoute } from "./routing";

describe("workspace routing", () => {
  it("reads workspace, document, archive, and management routes", () => {
    expect(readAppRoute("/workspaces")).toEqual({ kind: "workspaces" });
    expect(readAppRoute("/workspaces/default")).toEqual({
      kind: "documents",
      workspaceSlug: "default",
      documentSlug: null,
    });
    expect(
      readAppRoute("/workspaces/research/documents/initial-spec"),
    ).toEqual({
      kind: "documents",
      workspaceSlug: "research",
      documentSlug: "initial-spec",
    });
    expect(readAppRoute("/workspaces/research/archive")).toEqual({
      kind: "archive",
      workspaceSlug: "research",
    });
  });

  it("rejects incomplete or invalid workspace routes", () => {
    expect(readAppRoute("/")).toEqual({ kind: "not-found" });
    expect(readAppRoute("/documents/initial-spec")).toEqual({
      kind: "not-found",
    });
    expect(readAppRoute("/workspaces/Invalid_Name")).toEqual({
      kind: "not-found",
    });
  });
});
