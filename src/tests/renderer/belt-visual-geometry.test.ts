import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
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
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         {
    //           id: "source-belt",
    //           definitionId: "belt_straight_1x1",
    //           position: { x: 0, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //         {
    //           id: "target-storager",
    //           definitionId: "storager_1",
    //           position: { x: 1, y: -1 },
    //           rotation: 270,
    //           config: {},
    //           tags: [],
    //         },
    //       ]
    const ctx = createGeometryContext({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-01-variant-1.schema6.json")),
    })

    const entries = resolveBeltInsertionEntries(ctx as never)

    expect(BELT_INSERTION_DEPTH_CELLS).toBe(0.2)
    expect(entries).toEqual([{
      sourceEntityId: "source-belt",
      targetEntityId: "target-storager",
      boundary: {
        x: 1,
        y: 0.5,
      },
      edge: "EAST",
      angleRadians: 0,
    }])
  })

  it("does not create insertion entries for belt-to-belt continuation or blueprint-style display", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         {
    //           id: "source-belt",
    //           definitionId: "belt_straight_1x1",
    //           position: { x: 0, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //         {
    //           id: "next-belt",
    //           definitionId: "belt_straight_1x1",
    //           position: { x: 1, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //       ]
    const beltToBeltCtx = createGeometryContext({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-02-variant-1.schema6.json")),
    })
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         {
    //           id: "source-belt",
    //           definitionId: "belt_straight_1x1",
    //           position: { x: 0, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //         {
    //           id: "target-storager",
    //           definitionId: "storager_1",
    //           position: { x: 1, y: -1 },
    //           rotation: 270,
    //           config: {},
    //           tags: [],
    //         },
    //       ]
    const simplifiedCtx = createGeometryContext({
      simplifiedDeviceIcons: true,
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-03-variant-1.schema6.json")),
    })

    expect(resolveBeltInsertionEntries(beltToBeltCtx as never)).toEqual([])
    expect(resolveBeltInsertionEntries(simplifiedCtx as never)).toEqual([])
  })

  it("does not create extension entries when strict belts connect to general logistics devices", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         createBeltEntity("source-belt", { x: 0, y: 0 }, 0),
    //         {
    //           id: "target-splitter",
    //           definitionId: "log_splitter",
    //           position: { x: 1, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //       ]
    const beltToLogisticsCtx = createGeometryContext({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-04-variant-1.schema6.json")),
    })
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         {
    //           id: "source-connector",
    //           definitionId: "log_connector",
    //           position: { x: -1, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //         createBeltEntity("target-belt", { x: 0, y: 0 }, 0),
    //       ]
    const logisticsToBeltCtx = createGeometryContext({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-05-variant-1.schema6.json")),
    })

    expect(resolveBeltPortExtensionEntries(beltToLogisticsCtx as never)).toEqual([])
    expect(resolveBeltPortExtensionEntries(logisticsToBeltCtx as never)).toEqual([])
  })

  it("does not create extension entries when strict belts connect to the infinite solid device", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         createBeltEntity("source-belt", { x: 0, y: 0 }, 0),
    //         {
    //           id: "target-infinite",
    //           definitionId: "cheat_infinite_solid",
    //           position: { x: 1, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //       ]
    const beltToInfiniteCtx = createGeometryContext({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-06-variant-1.schema6.json")),
    })
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         {
    //           id: "source-infinite",
    //           definitionId: "cheat_infinite_solid",
    //           position: { x: -1, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //         createBeltEntity("target-belt", { x: 0, y: 0 }, 0),
    //       ]
    const infiniteToBeltCtx = createGeometryContext({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-07-variant-1.schema6.json")),
    })

    expect(resolveBeltPortExtensionEntries(beltToInfiniteCtx as never)).toEqual([])
    expect(resolveBeltPortExtensionEntries(infiniteToBeltCtx as never)).toEqual([])
  })

  it("resolves a device output protrusion into a strict belt input", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         {
    //           id: "source-storager",
    //           definitionId: "storager_1",
    //           position: { x: -3, y: 0 },
    //           rotation: 270,
    //           config: {},
    //           tags: [],
    //         },
    //         {
    //           id: "target-belt",
    //           definitionId: "belt_straight_1x1",
    //           position: { x: 0, y: 0 },
    //           rotation: 0,
    //           config: {},
    //           tags: [],
    //         },
    //       ]
    const ctx = createGeometryContext({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-08-variant-1.schema6.json")),
    })

    expect(resolveBeltPortExtensionEntries(ctx as never)).toEqual([{
      kind: "device-output-to-belt",
      beltEntityId: "target-belt",
      deviceEntityId: "source-storager",
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
      queries: registry.queries,
    })

    expect(sample?.point.x).toBeCloseTo(0.6464466094)
    expect(sample?.point.y).toBeCloseTo(0.3535533906)
    expect(sample?.angleRadians).toBeCloseTo(-2.3561944902)
  })

  it("resolves continuous phase offsets across connected strict belts", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [
    //         createBeltEntity("belt-a", { x: 0, y: 0 }, 0),
    //         createBeltEntity("belt-b", { x: 1, y: 0 }, 0),
    //         createBeltEntity("belt-c", { x: 2, y: 0 }, 0),
    //       ]
    const ctx = createGeometryContext({
      entities: getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/belt-visual-geometry/scene-09-variant-1.schema6.json")),
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
      queries: registry.queries,
    })
    const turnLength = resolveBeltPathLengthCells(turnDefinition)
    const turnSample = resolveBeltPathSampleAtDistance({
      entity: {
        ...createBeltEntity("turn", { x: 0, y: 0 }, 0),
        definitionId: "belt_turn_cw_1x1",
      },
      definition: turnDefinition,
      distanceCells: (turnLength ?? 0) / 2,
      queries: registry.queries,
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
    renderHost: {
      workspace: {
        app: {
          state: {
            settings: {
              gameUseBlueprintStyleDeviceImages: options.simplifiedDeviceIcons ?? false,
            },
          },
        },
        registry,
        editor: {
          queries: {
            listEntities: () => options.entities,
          },
        },
      } as never,
      textureManager: {
        getTexture: (async () => ({ width: 32, height: 32 })) as never,
      } as never,
    } as never,
    nowMs: 1000,
  }
}
