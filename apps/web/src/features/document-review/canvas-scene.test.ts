import { describe, expect, it } from "vitest";

import {
  boundsBetween,
  createCanvasTarget,
  describeCanvasElements,
  findElementAtPoint,
  findElementsInBounds,
  readCanvasSections,
  readElementBounds,
  sceneToViewport,
  viewportToScene,
  type CanvasElement,
} from "./canvas-scene";

const api: CanvasElement = {
  id: "api",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
};
const apiLabel: CanvasElement = {
  id: "api-label",
  type: "text",
  x: 20,
  y: 15,
  width: 60,
  height: 20,
  text: "API\ngateway",
  originalText: "API gateway",
  containerId: "api",
};
const database: CanvasElement = {
  id: "db",
  type: "ellipse",
  x: 300,
  y: 0,
  width: 100,
  height: 50,
};
const databaseLabel: CanvasElement = {
  id: "db-label",
  type: "text",
  x: 320,
  y: 15,
  width: 60,
  height: 20,
  text: "Database",
  containerId: "db",
};
const arrow: CanvasElement = {
  id: "calls",
  type: "arrow",
  x: 100,
  y: 25,
  width: 200,
  height: 0,
  points: [
    [0, 0],
    [200, 0],
  ],
  startBinding: { elementId: "api" },
  endBinding: { elementId: "db" },
};
const frame: CanvasElement = {
  id: "backend",
  type: "frame",
  x: -50,
  y: -50,
  width: 500,
  height: 200,
  name: "Backend",
};
const scene = [frame, api, apiLabel, database, databaseLabel, arrow];

describe("camera mapping", () => {
  it("maps scene points to the canvas and back", () => {
    const viewport = { scrollX: 40, scrollY: -10, zoom: 2 };
    const point = { x: 15, y: 30 };

    expect(sceneToViewport(point, viewport)).toEqual({ x: 110, y: 40 });
    expect(viewportToScene(sceneToViewport(point, viewport), viewport)).toEqual(
      point,
    );
  });
});

describe("findElementAtPoint", () => {
  it("picks a shape, through its label too", () => {
    expect(findElementAtPoint(scene, { x: 10, y: 10 }, 1)?.id).toBe("api");
    expect(findElementAtPoint(scene, { x: 50, y: 25 }, 1)?.id).toBe("api");
  });

  it("hits an arrow near its line but not elsewhere in its box", () => {
    expect(findElementAtPoint(scene, { x: 200, y: 29 }, 1)?.id).toBe("calls");
    // The same distance is out of reach when zoomed in, which narrows the
    // tolerance in scene units.
    expect(findElementAtPoint(scene, { x: 200, y: 29 }, 4)?.id).toBe(
      "backend",
    );
  });

  it("falls back to a frame only when nothing inside it was hit", () => {
    expect(findElementAtPoint(scene, { x: 200, y: 120 }, 1)?.id).toBe(
      "backend",
    );
    expect(findElementAtPoint(scene, { x: 900, y: 900 }, 1)).toBeNull();
  });

  it("follows a rotated element", () => {
    const bar: CanvasElement = {
      id: "bar",
      type: "rectangle",
      x: 0,
      y: 45,
      width: 100,
      height: 10,
      angle: Math.PI / 2,
    };

    expect(findElementAtPoint([bar], { x: 50, y: 5 }, 1)?.id).toBe("bar");
    expect(findElementAtPoint([bar], { x: 5, y: 50 }, 1)).toBeNull();
    expect(readElementBounds(bar)).toEqual({
      x: expect.closeTo(45),
      y: expect.closeTo(0),
      width: expect.closeTo(10),
      height: expect.closeTo(100),
    });
  });

  it("lets a transparent box drawn over others enclose them, not hide them", () => {
    const vpc: CanvasElement = { id: "vpc", type: "rectangle", x: -40, y: -40, width: 400, height: 200 };
    const filledApi: CanvasElement = { ...api, backgroundColor: "#ffec99" };
    // The VPC is listed last, so it is drawn on top of everything inside it.
    const layered = [filledApi, apiLabel, database, vpc];

    expect(findElementAtPoint(layered, { x: 10, y: 40 }, 1)?.id).toBe("api");
    expect(findElementAtPoint(layered, { x: 340, y: 20 }, 1)?.id).toBe("db");
    expect(findElementAtPoint(layered, { x: 150, y: 120 }, 1)?.id).toBe("vpc");
    // Its outline is drawn, so a click on the edge picks it.
    expect(findElementAtPoint(layered, { x: -40, y: 60 }, 1)?.id).toBe("vpc");
    // A filled box on top hides what is under it, as on screen.
    expect(
      findElementAtPoint(
        [filledApi, { ...vpc, backgroundColor: "#ffffff" }],
        { x: 10, y: 40 },
        1,
      )?.id,
    ).toBe("vpc");
  });

  it("follows a curved arrow along its curve", () => {
    const curve: CanvasElement = {
      id: "curve",
      type: "arrow",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [100, 100],
        [200, 0],
      ],
    };
    // Between the first two points the curve bulges past the straight line
    // toward the middle point's far side.
    const onCurve = { x: 50, y: 64 };

    expect(findElementAtPoint([curve], onCurve, 1)?.id).toBe("curve");
    expect(
      findElementAtPoint([{ ...curve, roundness: null }], onCurve, 1),
    ).toBeNull();
  });

  it("skips deleted elements", () => {
    expect(
      findElementAtPoint([{ ...api, isDeleted: true }], { x: 10, y: 10 }, 1),
    ).toBeNull();
  });
});

describe("findElementsInBounds", () => {
  it("picks whole elements, with labels riding on their shapes", () => {
    const picked = findElementsInBounds(
      scene,
      boundsBetween({ x: 410, y: 60 }, { x: -10, y: -10 }),
    );

    expect(picked.map((element) => element.id)).toEqual(["api", "db", "calls"]);
  });
});

describe("describeCanvasElements", () => {
  it("names elements by their text, and arrows by their ends", () => {
    expect(describeCanvasElements(scene, [api])).toBe("API gateway");
    expect(describeCanvasElements(scene, [arrow, database])).toBe(
      "Arrow from “API gateway” to “Database”, Database",
    );
    expect(describeCanvasElements(scene, [frame])).toBe("Backend");
    expect(
      describeCanvasElements(scene, [{ ...arrow, endBinding: null }]),
    ).toBe("Arrow from “API gateway”");
    expect(
      describeCanvasElements([], [{ ...api, id: "plain" }]),
    ).toBe("Rectangle");
    expect(describeCanvasElements(scene, [])).toBe("Empty area");
  });
});

describe("many picked elements", () => {
  it("keeps the first 50 ids, covers them all, and counts the rest by name", () => {
    const boxes: CanvasElement[] = Array.from({ length: 60 }, (_, index) => ({
      id: `box-${index}`,
      type: "rectangle",
      x: index * 10,
      y: 0,
      width: 5,
      height: 5,
    }));
    const target = createCanvasTarget(boxes, null);

    expect(target.elementIds).toHaveLength(50);
    expect(target.elementIds.at(-1)).toBe("box-49");
    expect(target.bounds).toEqual({ x: 0, y: 0, width: 595, height: 5 });
    expect(describeCanvasElements(boxes, boxes)).toBe(
      `${Array(12).fill("Rectangle").join(", ")}, and 48 more`,
    );
  });
});

describe("createCanvasTarget", () => {
  it("covers the picked elements, or the area drawn on empty canvas", () => {
    expect(createCanvasTarget([api, arrow], null)).toEqual({
      elementIds: ["api", "calls"],
      bounds: { x: 0, y: 0, width: 300, height: 50 },
    });
    expect(
      createCanvasTarget([], { x: 10.4, y: 20.6, width: 5.5, height: 0 }),
    ).toEqual({
      elementIds: [],
      bounds: { x: 10, y: 21, width: 6, height: 0 },
    });
  });
});

describe("readCanvasSections", () => {
  it("lists frames in reading order, naming unnamed ones", () => {
    expect(
      readCanvasSections([
        { ...frame, id: "lower", y: 400, name: null },
        frame,
        { ...frame, id: "gone", isDeleted: true },
      ]),
    ).toEqual([
      { elementId: "backend", text: "Backend" },
      { elementId: "lower", text: "Frame 2" },
    ]);
  });
});
