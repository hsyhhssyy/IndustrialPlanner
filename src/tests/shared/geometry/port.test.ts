import { describe, expect, it } from "vitest";

import { resolveRotatedPortGeometry } from "@/shared/geometry/port";

describe("port geometry", () => {
  it("rotates local port cells and edges clockwise", () => {
    const footprint = { width: 6, height: 5 };
    const port = {
      localCellX: 0,
      localCellY: 1,
      edge: "WEST" as const,
    };

    expect(resolveRotatedPortGeometry({ footprint, port, rotation: 0 })).toMatchObject({
      cell: { x: 0, y: 1 },
      edge: "WEST",
      delta: { x: -1, y: 0 },
    });
    expect(resolveRotatedPortGeometry({ footprint, port, rotation: 90 })).toMatchObject({
      cell: { x: 3, y: 0 },
      edge: "NORTH",
      delta: { x: 0, y: -1 },
    });
    expect(resolveRotatedPortGeometry({ footprint, port, rotation: 180 })).toMatchObject({
      cell: { x: 5, y: 3 },
      edge: "EAST",
      delta: { x: 1, y: 0 },
    });
    expect(resolveRotatedPortGeometry({ footprint, port, rotation: 270 })).toMatchObject({
      cell: { x: 1, y: 5 },
      edge: "SOUTH",
      delta: { x: 0, y: 1 },
    });
  });
});
