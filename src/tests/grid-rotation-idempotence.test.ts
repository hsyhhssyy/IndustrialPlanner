import { describe, expect, it } from "vitest";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
  resolveCenteredRotatedGridPoint,
  rotateGridRotationClockwise,
  type GridPoint,
  type GridRotation,
} from "@/shared/geometry/grid";

interface RotationState {
  gridPoint: GridPoint;
  rotation: GridRotation;
}

const NON_SQUARE_STAGE1_FOOTPRINTS = createStage1Registry()
  .entityDefinitions.filter(
    (definition) => definition.footprint.width !== definition.footprint.height,
  )
  .map((definition) => ({
    definitionId: definition.id,
    footprint: definition.footprint,
  }));

function rotateOnceKeepingCenter(
  state: RotationState,
  footprint: { width: number; height: number },
): RotationState {
  const nextRotation = rotateGridRotationClockwise(state.rotation);
  const currentFootprint = getRotatedGridFootprint(footprint, state.rotation);
  const nextFootprint = getRotatedGridFootprint(footprint, nextRotation);

  return {
    rotation: nextRotation,
    gridPoint: resolveCenteredRotatedGridPoint({
      gridPoint: state.gridPoint,
      currentFootprint,
      nextFootprint,
    }),
  };
}

describe("Centered grid rotation invariant", () => {
  it("keeps the geometric center stable for current non-square Stage1 footprints", () => {
    const initialState: RotationState = {
      gridPoint: { x: 11, y: 7 },
      rotation: 0,
    };

    for (const { definitionId, footprint } of NON_SQUARE_STAGE1_FOOTPRINTS) {
      let state = initialState;
      const initialCenter = getGridFootprintCenterCells(
        state.gridPoint,
        getRotatedGridFootprint(footprint, state.rotation),
      );

      for (let step = 0; step < 4; step += 1) {
        state = rotateOnceKeepingCenter(state, footprint);

        expect(
          getGridFootprintCenterCells(
            state.gridPoint,
            getRotatedGridFootprint(footprint, state.rotation),
          ),
          definitionId,
        ).toEqual(initialCenter);
      }
    }
  });

  it("returns to the original grid point and rotation after four centered rotations", () => {
    const initialState: RotationState = {
      gridPoint: { x: 11, y: 7 },
      rotation: 0,
    };

    for (const { definitionId, footprint } of NON_SQUARE_STAGE1_FOOTPRINTS) {
      let state = initialState;

      for (let step = 0; step < 4; step += 1) {
        state = rotateOnceKeepingCenter(state, footprint);
      }

      expect(state, definitionId).toEqual(initialState);
    }
  });
});