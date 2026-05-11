import { describe, expect, it } from "vitest"

import { createRegistryContract } from "@/registry"
import {
  BELT_INSERTION_DEPTH_CELLS,
  resolveBeltInsertionEntries,
  resolveBeltPathLengthCells,
  resolveBeltPathSample,
  resolveBeltPathSampleAtDistance,
  resolveBeltPortExtensionEntries,
  resolveBeltVisualPathEntries,
} from "@/renderer/scene/decorations/BeltVisualGeometry"

describe("BeltVisualGeometry", () => {
  it("resolves a belt insertion from a strict belt output into a target device input", () => {
    const ctx = createGeometryContext({
      entities: [
        {
          id: "source-belt",
          definitionId: "belt_straight_1x1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
        {
          id: "target-admission",
          definitionId: "item_log_admission",
          position: { x: 1, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
    })

    const entries = resolveBeltInsertionEntries(ctx as never)

    expect(BELT_INSERTION_DEPTH_CELLS).toBe(0.2)
    expect(entries).toEqual([{
      sourceEntityId: "source-belt",
      targetEntityId: "target-admission",
      boundary: {
        x: 1,
        y: 0.5,
      },
      edge: "EAST",
      angleRadians: 0,
    }])
  })

  it("does not create insertion entries for belt-to-belt continuation or blueprint-style display", () => {
    const beltToBeltCtx = createGeometryContext({
      entities: [
        {
          id: "source-belt",
          definitionId: "belt_straight_1x1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
        {
          id: "next-belt",
          definitionId: "belt_straight_1x1",
          position: { x: 1, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
    })
    const simplifiedCtx = createGeometryContext({
      simplifiedDeviceIcons: true,
      entities: [
        {
          id: "source-belt",
          definitionId: "belt_straight_1x1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
        {
          id: "target-admission",
          definitionId: "item_log_admission",
          position: { x: 1, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
    })

    expect(resolveBeltInsertionEntries(beltToBeltCtx as never)).toEqual([])
    expect(resolveBeltInsertionEntries(simplifiedCtx as never)).toEqual([])
  })

  it("resolves a device output protrusion into a strict belt input", () => {
    const ctx = createGeometryContext({
      entities: [
        {
          id: "source-connector",
          definitionId: "item_log_connector",
          position: { x: -1, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
        {
          id: "target-belt",
          definitionId: "belt_straight_1x1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      ],
    })

    expect(resolveBeltPortExtensionEntries(ctx as never)).toEqual([{
      kind: "device-output-to-belt",
      beltEntityId: "target-belt",
      deviceEntityId: "source-connector",
      boundary: {
        x: 0,
        y: 0.5,
      },
      edge: "EAST",
      angleRadians: 0,
      localStartCells: -0.2,
      localEndCells: 0,
      spriteCenterXCells: 0.3,
    }])
  })

  it("samples turn belt cargo pose from the definition port path", () => {
    const registry = createRegistryContract()
    const definition = registry.entityDefinitions.find((item) => item.id === "belt_turn_cw_1x1")
    if (definition === undefined) {
      throw new Error("Expected belt_turn_cw_1x1 definition.")
    }

    const sample = resolveBeltPathSample({
      entity: {
        id: "turn",
        definitionId: "belt_turn_cw_1x1",
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
      definition,
      progress: 0.5,
    })

    expect(sample?.point.x).toBeCloseTo(0.6464466094)
    expect(sample?.point.y).toBeCloseTo(0.3535533906)
    expect(sample?.angleRadians).toBeCloseTo(-2.3561944902)
  })

  it("resolves continuous phase offsets across connected strict belts", () => {
    const ctx = createGeometryContext({
      entities: [
        createBeltEntity("belt-a", { x: 0, y: 0 }, 0),
        createBeltEntity("belt-b", { x: 1, y: 0 }, 0),
        createBeltEntity("belt-c", { x: 2, y: 0 }, 0),
      ],
    })

    const entries = resolveBeltVisualPathEntries(ctx as never)

    expect(entries.map((entry) => ({
      id: entry.entity.id,
      phaseOffsetCells: entry.phaseOffsetCells,
      lengthCells: entry.lengthCells,
    }))).toEqual([
      {
        id: "belt-a",
        phaseOffsetCells: 0,
        lengthCells: 1,
      },
      {
        id: "belt-b",
        phaseOffsetCells: 1,
        lengthCells: 1,
      },
      {
        id: "belt-c",
        phaseOffsetCells: 2,
        lengthCells: 1,
      },
    ])
  })

  it("samples belt pose by local path distance", () => {
    const registry = createRegistryContract()
    const straightDefinition = registry.entityDefinitions.find((item) => item.id === "belt_straight_1x1")
    const turnDefinition = registry.entityDefinitions.find((item) => item.id === "belt_turn_cw_1x1")
    if (straightDefinition === undefined || turnDefinition === undefined) {
      throw new Error("Expected belt definitions.")
    }

    const straightSample = resolveBeltPathSampleAtDistance({
      entity: createBeltEntity("belt", { x: 0, y: 0 }, 0),
      definition: straightDefinition,
      distanceCells: 0.25,
    })
    const turnLength = resolveBeltPathLengthCells(turnDefinition)
    const turnSample = resolveBeltPathSampleAtDistance({
      entity: {
        ...createBeltEntity("turn", { x: 0, y: 0 }, 0),
        definitionId: "belt_turn_cw_1x1",
      },
      definition: turnDefinition,
      distanceCells: (turnLength ?? 0) / 2,
    })

    expect(straightSample?.point).toEqual({
      x: 0.25,
      y: 0.5,
    })
    expect(turnLength).toBeCloseTo(Math.PI / 4)
    expect(turnSample?.point.x).toBeCloseTo(0.6464466094)
    expect(turnSample?.point.y).toBeCloseTo(0.3535533906)
  })
})

function createBeltEntity(
  id: string,
  position: { x: number; y: number },
  rotation: 0 | 90 | 180 | 270,
) {
  return {
    id,
    definitionId: "belt_straight_1x1",
    position,
    rotation,
    config: {},
    tags: [],
  }
}

function createGeometryContext(options: {
  simplifiedDeviceIcons?: boolean;
  entities: Array<{
    id: string;
    definitionId: string;
    position: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
    config: Record<string, unknown>;
    tags: string[];
  }>;
}) {
  const registry = createRegistryContract()

  return {
    viewportState: {
      width: 200,
      height: 200,
      resolution: 1,
      centerX: 0.5,
      centerY: 0.5,
      gridCellPixelSize: 100,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    },
    workspace: {
      app: {
        state: {
          settings: {
            gameUseSimplifiedDeviceIcons: options.simplifiedDeviceIcons ?? false,
          },
        },
      },
      registry: {
        entityDefinitions: registry.entityDefinitions,
        itemDefinitions: registry.itemDefinitions,
      },
      editor: {
        queries: {
          listEntities: () => options.entities,
        },
      },
    },
    nowMs: 1000,
  }
}
