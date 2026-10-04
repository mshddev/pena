import type { ExcalidrawScene } from "@pena/contracts";
import { describe, expect, it } from "vitest";

import {
  keepSavedBindings,
  listBoundArrows,
  readExpansionInput,
} from "./mixed-scene";

const saved = { seed: 7, version: 3 };

/** A saved drawing with a frame, revised with one skeleton and one replaced shape. */
const scene: ExcalidrawScene = {
  type: "excalidraw",
  elements: [
    { id: "backend", type: "frame", x: 0, y: 0, width: 400, height: 200, name: "Backend", ...saved },
    // The author replaced the saved "api" box with a skeleton under its id.
    { id: "api", type: "rectangle", x: 20, y: 20, width: 100, height: 60, label: { text: "API" } },
    { id: "db", type: "ellipse", x: 250, y: 20, width: 100, height: 60, frameId: "backend", ...saved },
    {
      id: "api-db",
      type: "arrow",
      x: 120,
      y: 50,
      startBinding: { elementId: "api", focus: 0, gap: 4 },
      endBinding: { elementId: "db", focus: 0, gap: 4 },
      ...saved,
    },
    { id: "cache", type: "rectangle", x: 20, y: 120, width: 100, height: 60, label: { text: "Cache" } },
    { id: "loose", type: "arrow", x: 0, y: 0, startBinding: { elementId: "gone" }, ...saved },
  ],
};

describe("readExpansionInput", () => {
  it("gives a saved frame an empty children list and leaves the rest alone", () => {
    const input = readExpansionInput(scene);

    expect(input[0]).toEqual({ ...scene.elements[0], children: [] });
    expect(input.slice(1)).toEqual(scene.elements.slice(1));
  });
});

describe("keepSavedBindings", () => {
  it("puts back a binding to a shape that is now a skeleton, not to a missing one", () => {
    // What restoring only the saved elements leaves: "api" is not among them.
    const restored = [
      { id: "db", startBinding: null, endBinding: null },
      { id: "api-db", startBinding: null, endBinding: { elementId: "db" } },
      { id: "loose", startBinding: null, endBinding: null },
    ];

    expect(keepSavedBindings(restored, scene)).toEqual([
      { id: "db", startBinding: null, endBinding: null },
      {
        id: "api-db",
        startBinding: { elementId: "api", focus: 0, gap: 4 },
        endBinding: { elementId: "db" },
      },
      { id: "loose", startBinding: null, endBinding: null },
    ]);
  });
});

describe("listBoundArrows", () => {
  it("lists a bound arrow on its shape once, keeping what is already there", () => {
    const elements = [
      { id: "api", boundElements: [{ id: "api-label", type: "text" }] },
      { id: "db", boundElements: [{ id: "api-db", type: "arrow" }] },
      { id: "api-db", startBinding: { elementId: "api" }, endBinding: { elementId: "db" } },
      { id: "loop", startBinding: { elementId: "api" }, endBinding: { elementId: "api" } },
    ];

    expect(listBoundArrows(elements).slice(0, 2)).toEqual([
      {
        id: "api",
        boundElements: [
          { id: "api-label", type: "text" },
          { id: "api-db", type: "arrow" },
          { id: "loop", type: "arrow" },
        ],
      },
      elements[1],
    ]);
  });
});
