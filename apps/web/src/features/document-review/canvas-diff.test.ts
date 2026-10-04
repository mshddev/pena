import { describe, expect, it } from "vitest";

import { diffCanvas } from "./canvas-diff";

function scene(elements: object[]): string {
  return JSON.stringify({ type: "excalidraw", elements });
}

const api = { id: "api", type: "rectangle", x: 0, y: 0, width: 100, height: 50 };
const apiLabel = {
  id: "api-label",
  type: "text",
  x: 10,
  y: 10,
  width: 80,
  height: 20,
  text: "API",
  containerId: "api",
};
const db = { id: "db", type: "ellipse", x: 300, y: 0, width: 100, height: 50, label: { text: "Database" } };

describe("diffCanvas", () => {
  it("lists added, removed, renamed, and moved elements", () => {
    const before = scene([api, apiLabel, db, { id: "note", type: "text", x: 0, y: 200, text: "Draft" }]);
    const after = scene([
      { ...api, x: 40 },
      { ...apiLabel, x: 50, text: "API gateway" },
      { ...db, strokeColor: "#e03131" },
      { id: "cache", type: "rectangle", x: 0, y: 100, label: { text: "Cache" } },
      { id: "calls", type: "arrow", x: 100, y: 25, startBinding: { elementId: "api" }, endBinding: { elementId: "db" } },
    ]);

    expect(diffCanvas(before, after)).toEqual([
      { kind: "removed", text: "Text “Draft”" },
      { kind: "removed", text: "Rectangle “API”" },
      { kind: "added", text: "Rectangle “API gateway”" },
      { kind: "context", text: "Ellipse “Database” — restyled" },
      { kind: "added", text: "Arrow from “API gateway” to “Database”" },
      { kind: "added", text: "Rectangle “Cache”" },
    ]);
  });

  it("says when no element changed, and falls back for non-scenes", () => {
    expect(diffCanvas(scene([api]), scene([api]))).toEqual([
      { kind: "context", text: "No element changed." },
    ]);
    expect(diffCanvas("## Old", "## New")).toEqual([
      { kind: "removed", text: "## Old" },
      { kind: "added", text: "## New" },
    ]);
  });
});
