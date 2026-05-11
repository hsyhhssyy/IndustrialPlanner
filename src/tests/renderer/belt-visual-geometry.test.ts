import { describe, expect, it } from "vitest"

import { createRegistryContract } from "@/registry"
import {
  BELT_INSERTION_DEPTH_CELLS,
  resolveBeltInsertionEntries,
  resolveBeltPathSample,
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
})

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
