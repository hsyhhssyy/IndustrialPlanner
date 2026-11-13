import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public visible = true
    public mask: unknown = null

    public addChild<T>(child: T): T {
      this.children.push(child)
      return child
    }

    public destroy = vi.fn()
  }

  class MockGraphics {
    public readonly drawCommands: Array<{
      type: "poly" | "rect";
      points?: number[];
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      fill?: unknown;
      stroke?: unknown;
    }> = []
    public visible = true
    public mask: unknown = null
    public roundPixels = false
    public readonly context: { instructions: unknown[] }
    public destroy = vi.fn()

    public constructor(options?: { roundPixels?: boolean }) {
      this.roundPixels = options?.roundPixels ?? false
      // 提供 context.instructions 兼容旧断言（drawCommands.length 映射）
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- getter 内需要捕获外部 this
      const self = this
      this.context = {
        get instructions() {
          return Array.from({ length: self.drawCommands.length })
        },
      }
    }

    public clear(): this {
      this.drawCommands.length = 0
      return this
    }

    public rect(x: number, y: number, width: number, height: number): this {
      this.drawCommands.push({ type: "rect", x, y, width, height })
      return this
    }

    public poly(points: number[]): this {
      this.drawCommands.push({ type: "poly", points })
      return this
    }

    public fill(fill: unknown): this {
      const command = this.drawCommands.at(-1)
      if (command !== undefined) {
        command.fill = fill
      }
      return this
    }

    public stroke(stroke: unknown): this {
      const command = this.drawCommands.at(-1)
      if (command !== undefined) {
        command.stroke = stroke
      }
      return this
    }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
  }
})

import { AYU_LIGHT_THEME } from "@/app/theme"
// AI-REMOVED 2026-11-12:
// Reason: 装饰改读 SceneViewInput，旧仿真查询桩不能证明真实有流体/无流体状态。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 复用既有 pipe-fluid-query 版本化生产场景和真实 SimulationHost。
// Replacement: 本文件真实两节管道场景与启动、推进、停止动作。
// Risk: Low；箭头显隐、数量和统计原断言保持。
// Human Review: Required
// Original code:
// import { createRegistryContract } from "@/registry"


let createPipeFlowDecoration: typeof import("@/renderer/scene/decorations/PipeFlowDecoration")["createPipeFlowDecoration"]

beforeAll(async () => {
  createPipeFlowDecoration = (await import("@/renderer/scene/decorations/PipeFlowDecoration"))
    .createPipeFlowDecoration
})

// AI-REMOVED 2026-11-12:
// Reason: 装饰改读 SceneViewInput，旧仿真查询桩不能证明真实有流体/无流体状态。
// Trigger: REQ-048 场景接口迁移。
// Evidence: 复用既有 pipe-fluid-query 版本化生产场景和真实 SimulationHost。
// Replacement: 本文件真实两节管道场景与启动、推进、停止动作。
// Risk: Low；箭头显隐、数量和统计原断言保持。
// Human Review: Required
// Original code:
// describe("PipeFlowDecoration", () => {
//   it("draws double chevrons for all pipe transport components regardless of fluid", () => {
//     const decoration = createPipeFlowDecoration()
//     const pipeFluidItemIds = new Map<string, string | null>([
//       ["pipe-a", null],
//       ["pipe-b", null],
//     ])
//     const getPipeFluidItemId = vi.fn((entityId: string) => pipeFluidItemIds.get(entityId) ?? null)
//     const ctx = createPipeFlowContext({ getPipeFluidItemId })
//
//     // 无流体时也显示 decoration
//     decoration.sync(ctx as never)
//
//     const arrowGraphics = decoration.container.children[0] as unknown as { context: { instructions: unknown[] }; visible: boolean }
//     const arrowMask = decoration.container.children[1] as unknown as { context: { instructions: unknown[] }; visible: boolean }
//     expect(decoration.container.visible).toBe(true)
//     expect(arrowGraphics.visible).toBe(true)
//     expect(arrowMask.visible).toBe(true)
//
//     // 有流体时同样显示
//     pipeFluidItemIds.set("pipe-a", "item_liquid_water")
//     pipeFluidItemIds.set("pipe-b", "item_liquid_water")
//     decoration.sync(ctx as never)
//
//     expect(decoration.container.visible).toBe(true)
//     expect(arrowGraphics.visible).toBe(true)
//     expect(arrowMask.visible).toBe(true)
//
//     // 流体恢复为空后仍然显示
//     pipeFluidItemIds.set("pipe-a", null)
//     pipeFluidItemIds.set("pipe-b", null)
//     decoration.sync(ctx as never)
//
//     expect(decoration.container.visible).toBe(true)
//     expect(arrowGraphics.visible).toBe(true)
//     expect(arrowMask.visible).toBe(true)
//
//     decoration.destroy()
//   })
//
//   it("records disjoint work stages and their input sizes", () => {
//     const decoration = createPipeFlowDecoration()
//     const samples = new Map<string, number>()
//     const ctx = createPipeFlowContext({
//       getPipeFluidItemId: () => "item_liquid_water",
//       recordSample: (name, value) => samples.set(name, value),
//     })
//
//     decoration.sync(ctx as never)
//
//     for (const name of [
//       "pipeFlow.activeScan-ms",
//       "pipeFlow.pathEntries-ms",
//       "pipeFlow.buildChains-ms",
//       "pipeFlow.generateMarks-ms",
//       "pipeFlow.drawMask-ms",
//       "pipeFlow.drawMarks-ms",
//     ]) {
//       expect(samples.get(name)).toBeGreaterThanOrEqual(0)
//     }
//     expect(samples.get("pipeFlow.activeEntityCount")).toBe(2)
//     expect(samples.get("pipeFlow.pathEntryCount")).toBe(2)
//     expect(samples.get("pipeFlow.chainCount")).toBe(1)
//     expect(samples.get("pipeFlow.markCount")).toBe(1)
//     expect(samples.get("pipeFlow.maskRectCount")).toBe(2)
//
//     decoration.destroy()
//   })
// })
//
// function createPipeFlowContext(options: {
//   getPipeFluidItemId: (entityId: string) => string | null;
//   recordSample?: (name: string, value: number) => void;
// }) {
//   const registry = createRegistryContract()
//   // AI-REMOVED 2026-09-14:
//   // Reason: 场景构造已批量固化为带版本的蓝图文件。
//   // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
//   // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
//   // Replacement: src/tests/fixtures/blueprints/collections/renderer/pipe-flow-decoration/index.json
//   // Risk: Low；断言与被测动作不变。
//   // Human Review: Required
//   // Original code:
//   // [
//   //     {
//   //       id: "pipe-a",
//   //       definitionId: "pipe_straight_1x1",
//   //       position: { x: 0, y: 0 },
//   //       rotation: 0,
//   //       config: {},
//   //       tags: [],
//   //     },
//   //     {
//   //       id: "pipe-b",
//   //       definitionId: "pipe_straight_1x1",
//   //       position: { x: 1, y: 0 },
//   //       rotation: 0,
//   //       config: {},
//   //       tags: [],
//   //     },
//   //   ]
//   const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/pipe-flow-decoration/scene-01-variant-1.schema7.json"))
//
//   return {
//     viewportState: {
//       width: 400,
//       height: 300,
//       resolution: 1,
//       centerX: 0,
//       centerY: 0,
//       gridCellPixelSize: 100,
//     },
//     viewportBounds: {
//       left: 0,
//       top: 0,
//       width: 400,
//       height: 300,
//     },
//     renderHost: {
//       workspace: {
//         app: {
//           state: {
//             settings: {
//               gameUseBlueprintStyleDeviceImages: false,
//             },
//           },
//         },
//         editor: {
//           state: {},
//           queries: {
//             listEntities: () => entities,
//           },
//         },
//         registry,
//         simulation: {
//           queries: {
//             getPipeFluidItemId: options.getPipeFluidItemId,
//           },
//         },
//       },
//     },
//     theme: AYU_LIGHT_THEME,
//     nowMs: 0,
//     profiler: options.recordSample === undefined
//       ? undefined
//       : {
//           count: options.recordSample,
//           measure: <T>(_stage: string, callback: () => T): T => callback(),
//         },
//   }
// }
//
import { createRenderTestScene } from "@/tests/helpers/render-test-scene"
import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers"
import { createSimulationHost } from "@/simulation/simulation-host"

const cleanups: Array<() => void> = []
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose() })

function createPipeFlowContext(options: { withSimulation?: boolean; recordSample?: (name: string, value: number) => void } = {}) {
  const scene = createRenderTestScene({ document: createWorldDocumentFromBlueprint(loadBlueprintFromFile(
    "src/tests/fixtures/blueprints/collections/req048/pipe-flow-runtime.schema7.json")) })
  cleanups.push(scene.dispose)
  scene.workspace.editor = scene.editor
  const simulation = options.withSimulation ? createSimulationHost(scene.workspace, { workerMode: "runtime" }) : null
  if (simulation !== null) cleanups.push(simulation.dispose)
  return {
    simulation,
    viewportState: { width: 400, height: 300, resolution: 1, centerX: 21, centerY: 20.5, gridCellPixelSize: 100 },
    viewportBounds: { left: 0, top: 0, width: 400, height: 300 },
    renderHost: { input: { ...scene.input, simulation } }, theme: AYU_LIGHT_THEME, nowMs: 0,
    profiler: options.recordSample === undefined ? undefined : {
      count: options.recordSample, measure: <T>(_stage: string, callback: () => T): T => callback(),
    },
  }
}

describe("PipeFlowDecoration", () => {
  it("draws double chevrons for all pipe transport components regardless of fluid", async () => {
    const ctx = createPipeFlowContext({ withSimulation: true })
    const decoration = createPipeFlowDecoration()
    cleanups.push(decoration.destroy)
    await ctx.simulation!.actions.start()
    expect(ctx.simulation!.state.runningState).toBe("start")
    expect(ctx.simulation!.queries.getPipeFluidItemId("pipe-a")).toBeNull()
    // 无流体时也显示 decoration
    decoration.sync(ctx as never)
    const arrowGraphics = decoration.container.children[0] as unknown as { context: { instructions: unknown[] }; visible: boolean }
    const arrowMask = decoration.container.children[1] as unknown as { context: { instructions: unknown[] }; visible: boolean }
    expect(decoration.container.visible).toBe(true)
    expect(arrowGraphics.visible).toBe(true)
    expect(arrowMask.visible).toBe(true)
    // 有流体时同样显示
    expect((await ctx.simulation!.internalActions.syncToTick(10)).status).toBe("ready")
    expect(ctx.simulation!.queries.getPipeFluidItemId("pipe-a")).toBe("item_liquid_water")
    decoration.sync(ctx as never)
    expect(decoration.container.visible).toBe(true)
    expect(arrowGraphics.visible).toBe(true)
    expect(arrowMask.visible).toBe(true)
    // 流体恢复为空后仍然显示
    ctx.simulation!.actions.stop()
    expect(ctx.simulation!.queries.getPipeFluidItemId("pipe-a")).toBeNull()
    decoration.sync(ctx as never)
    expect(decoration.container.visible).toBe(true)
    expect(arrowGraphics.visible).toBe(true)
    expect(arrowMask.visible).toBe(true)
  })

  it("records disjoint work stages and their input sizes", () => {
    const decoration = createPipeFlowDecoration()
    cleanups.push(decoration.destroy)
    const samples = new Map<string, number>()
    const ctx = createPipeFlowContext({ recordSample: (name, value) => samples.set(name, value) })
    decoration.sync(ctx as never)
    for (const name of ["pipeFlow.activeScan-ms", "pipeFlow.pathEntries-ms", "pipeFlow.buildChains-ms", "pipeFlow.generateMarks-ms", "pipeFlow.drawMask-ms", "pipeFlow.drawMarks-ms"]) {
      expect(samples.get(name)).toBeGreaterThanOrEqual(0)
    }
    expect(samples.get("pipeFlow.activeEntityCount")).toBe(2)
    expect(samples.get("pipeFlow.pathEntryCount")).toBe(2)
    expect(samples.get("pipeFlow.chainCount")).toBe(1)
    expect(samples.get("pipeFlow.markCount")).toBe(1)
    expect(samples.get("pipeFlow.maskRectCount")).toBe(2)
  })
})
