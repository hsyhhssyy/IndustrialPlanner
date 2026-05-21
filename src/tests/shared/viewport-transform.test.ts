import { describe, expect, it } from "vitest";

import type { GridRotation } from "@/domain/shared/grid";
import {
  resolveCompensatedViewportCenter,
  resolveViewportPointFromWorldPoint,
  resolveViewportRectFromWorldGridRect,
  resolveWorldPointFromViewportPoint,
  resolveWorldVectorFromViewportVector,
} from "@/shared/geometry/viewport-transform";

const VIEWPORT_BOUNDS = {
  left: 10,
  top: 20,
  width: 200,
  height: 120,
};
const VIEWPORT_CENTER = {
  x: 4,
  y: -2,
};
const GRID_CELL_PIXEL_SIZE = 16;

describe("viewport display rotation transform", () => {
  it.each<GridRotation>([0, 90, 180, 270])(
    "keeps the viewport center anchored at rotation %s",
    (displayRotation) => {
      expect(resolveViewportPointFromWorldPoint({
        worldPoint: VIEWPORT_CENTER,
        viewportBounds: VIEWPORT_BOUNDS,
        viewportCenter: VIEWPORT_CENTER,
        gridCellPixelSize: GRID_CELL_PIXEL_SIZE,
        displayRotation,
      })).toEqual({
        x: 110,
        y: 80,
      });
    },
  );

  it.each<GridRotation>([0, 90, 180, 270])(
    "round-trips viewport and world points at rotation %s",
    (displayRotation) => {
      const worldPoint = {
        x: 7.25,
        y: 3.5,
      };
      const viewportPoint = resolveViewportPointFromWorldPoint({
        worldPoint,
        viewportBounds: VIEWPORT_BOUNDS,
        viewportCenter: VIEWPORT_CENTER,
        gridCellPixelSize: GRID_CELL_PIXEL_SIZE,
        displayRotation,
      });

      expect(resolveWorldPointFromViewportPoint({
        viewportPoint,
        viewportBounds: VIEWPORT_BOUNDS,
        viewportCenter: VIEWPORT_CENTER,
        gridCellPixelSize: GRID_CELL_PIXEL_SIZE,
        displayRotation,
      })).toEqual(worldPoint);
    },
  );

  it("swaps a non-square grid rect footprint under a quarter-turn display rotation", () => {
    expect(resolveViewportRectFromWorldGridRect({
      gridRect: {
        x: 1,
        y: 2,
        width: 3,
        height: 2,
      },
      viewportBounds: {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
      viewportCenter: {
        x: 0,
        y: 0,
      },
      gridCellPixelSize: GRID_CELL_PIXEL_SIZE,
      displayRotation: 90,
    })).toEqual({
      left: 136,
      top: 216,
      width: 32,
      height: 48,
    });
  });

  it("maps viewport drag vectors back through the inverse display rotation", () => {
    expect(resolveWorldVectorFromViewportVector({
      viewportVector: {
        x: GRID_CELL_PIXEL_SIZE,
        y: 0,
      },
      displayRotation: 90,
    })).toEqual({
      x: 0,
      y: -GRID_CELL_PIXEL_SIZE,
    });
  });

  it("compensates viewport rect changes through display rotation", () => {
    expect(resolveCompensatedViewportCenter({
      previousClientRect: {
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      },
      nextClientRect: {
        left: 160,
        top: 0,
        width: 400,
        height: 400,
      },
      previousViewportCenter: {
        x: 0,
        y: 0,
      },
      gridCellPixelSize: GRID_CELL_PIXEL_SIZE,
      displayRotation: 90,
    })).toEqual({
      x: 0,
      y: -10,
    });
  });
});
