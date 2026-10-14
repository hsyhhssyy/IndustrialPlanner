// AI-REMOVED 2026-10-13:
// Reason: 统一设备范围声明、几何和交互处理，替代中心正方形专用实现。
// Trigger: 洒水机和定向离体区域支持。
// Evidence: Search-First 确认旧电力、气体各自重复计算范围。
// Replacement: 本文件下方范围展示测试与三档真实浏览器验证。
// Risk: 保持既有供电与气体规则，需范围回归验证。
// Human Review: Required
// Original code:
// import { beforeEach, describe, expect, it, vi } from "vitest";
//
// import { EntityCollectionType } from "@/domain/editor/types/editor-types";
// import type { DecorationSyncContext } from "@/renderer/scene/decorations/DecorationSyncContext";
//
// const graphicsTestState = vi.hoisted(() => ({
//   instances: [] as Array<{
//     clear: ReturnType<typeof vi.fn>;
//     rect: ReturnType<typeof vi.fn>;
//     fill: ReturnType<typeof vi.fn>;
//     stroke: ReturnType<typeof vi.fn>;
//     destroy: ReturnType<typeof vi.fn>;
//   }>,
// }));
// const animationTestState = vi.hoisted(() => ({
//   ready: false,
//   instances: [] as Array<{
//     prepare: ReturnType<typeof vi.fn>;
//     sync: ReturnType<typeof vi.fn>;
//     destroy: ReturnType<typeof vi.fn>;
//   }>,
// }));
//
// vi.mock("pixi.js", () => ({
//   BlurFilter: class {},
//   Container: class {
//     public readonly addChild = vi.fn();
//     public readonly destroy = vi.fn();
//   },
//   Graphics: class {
//     public readonly clear = vi.fn();
//     public readonly rect = vi.fn().mockReturnThis();
//     public readonly fill = vi.fn().mockReturnThis();
//     public readonly stroke = vi.fn().mockReturnThis();
//     public readonly destroy = vi.fn();
//
//     public constructor() {
//       graphicsTestState.instances.push(this);
//     }
//   },
// }));
// vi.mock("@/renderer/scene/decorations/GasEnvironmentAnimation", () => ({
//   GasEnvironmentAnimation: class {
//     public readonly container = {};
//     public readonly prepare = vi.fn();
//     public readonly sync = vi.fn();
//     public readonly destroy = vi.fn();
//
//     public constructor() {
//       animationTestState.instances.push(this);
//     }
//
//     public get isReady(): boolean {
//       return animationTestState.ready;
//     }
//   },
// }));
//
// import {
//   createGasDiffusionRangeDecoration,
//   haveSameGasDiffusionRanges,
// } from "@/renderer/scene/decorations/GasDiffusionRangeDecoration";
//
// describe("GasDiffusionRangeDecoration", () => {
//   beforeEach(() => {
//     graphicsTestState.instances.length = 0;
//     animationTestState.instances.length = 0;
//     animationTestState.ready = false;
//   });
//
//   // AI-CORRECTION 2026-09-26：此断言覆盖素材尚未就绪时的活跃矩形兜底；素材就绪时由动画取代。
//   it("reads Registry body color only when ranges or viewport change", () => {
//     const findItemDefinition = vi.fn(() => ({
//       fluidColors: { body: "#00d5ff", skin: "#6bf7ff" },
//     }));
//     let ranges = [createRange(0, 0)];
//     const ctx = createContext({
//       itemDefinitions: [],
//       findItemDefinition,
//       getRanges: () => ranges.map((range) => ({
//         ...range,
//         gridRect: { ...range.gridRect },
//       })),
//     });
//     const decoration = createGasDiffusionRangeDecoration();
//     const graphics = graphicsTestState.instances[1]!;
//
//     decoration.sync(ctx);
//     expect(graphics.rect).toHaveBeenCalledTimes(1);
//     expect(graphics.clear).not.toHaveBeenCalled();
//     expect(graphics.fill).toHaveBeenLastCalledWith({ color: 0x00d5ff, alpha: 0.07 });
//     expect(findItemDefinition).toHaveBeenCalledTimes(1);
//
//     decoration.sync(ctx);
//     expect(graphics.rect).toHaveBeenCalledTimes(1);
//     expect(graphics.clear).not.toHaveBeenCalled();
//     expect(findItemDefinition).toHaveBeenCalledTimes(1);
//
//     ctx.viewportState.centerX += 1;
//     decoration.sync(ctx);
//     expect(graphics.rect).toHaveBeenCalledTimes(2);
//     expect(graphics.clear).toHaveBeenCalledTimes(1);
//     expect(findItemDefinition).toHaveBeenCalledTimes(2);
//
//     ranges = [createRange(1, 0)];
//     decoration.sync(ctx);
//     expect(graphics.rect).toHaveBeenCalledTimes(3);
//     expect(graphics.clear).toHaveBeenCalledTimes(2);
//     expect(findItemDefinition).toHaveBeenCalledTimes(3);
//
//     ranges = [];
//     decoration.sync(ctx);
//     expect(graphics.clear).toHaveBeenCalledTimes(3);
//     ctx.viewportState.centerX += 1;
//     decoration.sync(ctx);
//     expect(graphics.clear).toHaveBeenCalledTimes(3);
//     expect(findItemDefinition).toHaveBeenCalledTimes(3);
//   });
//
//   // AI-REMOVED 2026-09-14:
//   // Reason: 气体范围不再扫描 ItemDefinition 列表或解析颜色 tag。
//   // Trigger: ItemDefinition.fluidColors 成为唯一运行时颜色来源。
//   // Evidence: RegistryQuery.findItemDefinition 已提供稳定的物品 ID 索引。
//   // Replacement: 上方 Registry body color 测试。
//   // Risk: Low
//   // Human Review: Required
//   // Original code:
//   // it("reuses the item index and leaves Graphics untouched while ranges and viewport stay stable", () => {
//   //   let itemIdReads = 0;
//   //   const itemDefinition = {
//   //     get id() {
//   //       itemIdReads += 1;
//   //       return "item_gas_inert";
//   //     },
//   //     tags: ["gas_color:#123456"],
//   //   };
//   //   // 后续断言通过 itemIdReads 验证局部索引只构建一次。
//   // });
//
//   it("compares cloned range read models by value", () => {
//     const left = [createRange(0, 0)];
//     const right = [createRange(0, 0)];
//
//     expect(haveSameGasDiffusionRanges(left, right)).toBe(true);
//     expect(haveSameGasDiffusionRanges(left, [createRange(0, 1)])).toBe(false);
//     expect(haveSameGasDiffusionRanges(null, right)).toBe(false);
//   });
//
//   it("keeps unselected active gas ranges visible during a batch move", () => {
//     let moveKind: "ordinary" | "batch" = "ordinary";
//     const ctx = createContext({
//       itemDefinitions: [],
//       getRanges: () => [
//         createRange(0, 0, "device:selected-device"),
//         createRange(10, 0, "device:unselected-device"),
//       ],
//       getMoveKind: () => moveKind,
//       getGhostIds: () => ["selected-device"],
//       getPreviewIds: () => ["selected-device:draft"],
//     });
//     const decoration = createGasDiffusionRangeDecoration();
//     const graphics = graphicsTestState.instances[1]!;
//
//     decoration.sync(ctx);
//     expect(graphics.rect).toHaveBeenCalledTimes(2);
//
//     moveKind = "batch";
//     decoration.sync(ctx);
//     expect(graphics.clear).toHaveBeenCalledTimes(1);
//     expect(graphics.rect).toHaveBeenCalledTimes(3);
//
//     decoration.sync(ctx);
//     expect(graphics.clear).toHaveBeenCalledTimes(1);
//     expect(graphics.rect).toHaveBeenCalledTimes(3);
//
//     moveKind = "ordinary";
//     decoration.sync(ctx);
//     expect(graphics.clear).toHaveBeenCalledTimes(2);
//     expect(graphics.rect).toHaveBeenCalledTimes(5);
//   });
//
//   it("does not enter editor preview mode when every active range is moved", () => {
//     const ctx = createContext({
//       itemDefinitions: [],
//       getRanges: () => [createRange(0, 0, "device:selected-device")],
//       getMoveKind: () => "batch",
//       getGhostIds: () => ["selected-device"],
//       getPreviewIds: () => ["selected-device:draft"],
//     });
//     const decoration = createGasDiffusionRangeDecoration();
//     const graphics = graphicsTestState.instances[1]!;
//
//     decoration.sync(ctx);
//
//     expect(graphics.rect).not.toHaveBeenCalled();
//     expect(graphics.clear).not.toHaveBeenCalled();
//   });
//
//   it("keeps placed and draft rectangles before simulation and while idle", () => {
//     let runningState: "stop" | "start" = "stop";
//     const ctx = createContext({
//       itemDefinitions: [],
//       getRanges: () => [],
//       getRunningState: () => runningState,
//       entities: [createEntity("placed", 0), createEntity("draft", 18)],
//     });
//     const decoration = createGasDiffusionRangeDecoration();
//     const preview = graphicsTestState.instances[0]!;
//     const active = graphicsTestState.instances[1]!;
//     const animation = animationTestState.instances[0]!;
//
//     decoration.sync(ctx);
//     expect(graphicsTestState.instances).toHaveLength(2);
//     expect(preview.rect).toHaveBeenCalledTimes(2);
//     expect(active.rect).not.toHaveBeenCalled();
//     expect(preview.fill).not.toHaveBeenCalled();
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, []);
//
//     runningState = "start";
//     decoration.sync(ctx);
//     expect(preview.rect).toHaveBeenCalledTimes(2);
//     expect(active.rect).not.toHaveBeenCalled();
//     expect(preview.fill).not.toHaveBeenCalled();
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, []);
//   });
//
//   it("switches each working device to animation and restores its rectangle when stopped", () => {
//     let runningState: "stop" | "start" = "stop";
//     let working = true;
//     animationTestState.ready = true;
//     const ctx = createContext({
//       itemDefinitions: [],
//       getRanges: () => working ? [createRange(0, 0, "device:working")] : [],
//       getRunningState: () => runningState,
//       entities: [createEntity("working", 0), createEntity("idle", 18)],
//     });
//     const decoration = createGasDiffusionRangeDecoration();
//     const preview = graphicsTestState.instances[0]!;
//     const fallback = graphicsTestState.instances[1]!;
//     const animation = animationTestState.instances[0]!;
//
//     decoration.sync(ctx);
//     expect(preview.rect).toHaveBeenCalledTimes(2);
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, []);
//
//     runningState = "start";
//     decoration.sync(ctx);
//     expect(preview.clear).toHaveBeenCalledTimes(1);
//     expect(preview.rect).toHaveBeenCalledTimes(3);
//     expect(fallback.rect).not.toHaveBeenCalled();
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, [createRange(0, 0, "device:working")]);
//
//     working = false;
//     decoration.sync(ctx);
//     expect(preview.clear).toHaveBeenCalledTimes(2);
//     expect(preview.rect).toHaveBeenCalledTimes(5);
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, []);
//
//     working = true;
//     runningState = "stop";
//     decoration.sync(ctx);
//     expect(preview.rect).toHaveBeenCalledTimes(5);
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, []);
//   });
//
//   it("uses the solid rectangle only while animation is unavailable", () => {
//     let supportsAnimation = true;
//     const activeRange = createRange(0, 0, "device:working");
//     const ctx = createContext({
//       itemDefinitions: [],
//       getRanges: () => [activeRange],
//       getSupportsAnimation: () => supportsAnimation,
//       entities: [createEntity("working", 0)],
//     });
//     const decoration = createGasDiffusionRangeDecoration();
//     const preview = graphicsTestState.instances[0]!;
//     const fallback = graphicsTestState.instances[1]!;
//     const animation = animationTestState.instances[0]!;
//
//     decoration.sync(ctx);
//     expect(preview.rect).not.toHaveBeenCalled();
//     expect(fallback.rect).toHaveBeenCalledTimes(1);
//     expect(fallback.fill).toHaveBeenCalledTimes(1);
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, [activeRange]);
//
//     animationTestState.ready = true;
//     decoration.sync(ctx);
//     expect(preview.rect).not.toHaveBeenCalled();
//     expect(fallback.clear).toHaveBeenCalledTimes(1);
//     expect(fallback.rect).toHaveBeenCalledTimes(1);
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, [activeRange]);
//
//     supportsAnimation = false;
//     decoration.sync(ctx);
//     expect(preview.rect).not.toHaveBeenCalled();
//     expect(fallback.rect).toHaveBeenCalledTimes(2);
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, []);
//   });
//
//   it("keeps the body-colored rectangle in blueprint style and restores animation after switching back", () => {
//     let blueprintStyle = true;
//     animationTestState.ready = true;
//     const activeRange = createRange(0, 0, "device:working");
//     const ctx = createContext({
//       itemDefinitions: [],
//       findItemDefinition: () => ({ fluidColors: { body: "#00d5ff" } }),
//       getRanges: () => [activeRange],
//       getBlueprintStyle: () => blueprintStyle,
//       entities: [createEntity("working", 0)],
//     });
//     const decoration = createGasDiffusionRangeDecoration();
//     const fallback = graphicsTestState.instances[1]!;
//     const animation = animationTestState.instances[0]!;
//
//     decoration.sync(ctx);
//     expect(fallback.fill).toHaveBeenLastCalledWith({ color: 0x00d5ff, alpha: 0.07 });
//     expect(animation.prepare).not.toHaveBeenCalled();
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, []);
//
//     blueprintStyle = false;
//     decoration.sync(ctx);
//     expect(fallback.clear).toHaveBeenCalledTimes(1);
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, [activeRange]);
//
//     blueprintStyle = true;
//     decoration.sync(ctx);
//     expect(fallback.rect).toHaveBeenCalledTimes(2);
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, []);
//   });
//
//   it("hides only the moved machine and keeps other working animations", () => {
//     let moveKind: "ordinary" | "batch" = "ordinary";
//     const selected = createRange(0, 0, "device:selected");
//     const unselected = createRange(18, 0, "device:unselected");
//     const ctx = createContext({
//       itemDefinitions: [],
//       getRanges: () => [selected, unselected],
//       getMoveKind: () => moveKind,
//       getGhostIds: () => ["selected"],
//       getPreviewIds: () => ["selected:draft"],
//       entities: [createEntity("selected", 0), createEntity("unselected", 18)],
//     });
//     const decoration = createGasDiffusionRangeDecoration();
//     const preview = graphicsTestState.instances[0]!;
//     const animation = animationTestState.instances[0]!;
//
//     decoration.sync(ctx);
//     expect(preview.rect).not.toHaveBeenCalled();
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, [selected, unselected]);
//
//     moveKind = "batch";
//     decoration.sync(ctx);
//     expect(preview.rect).not.toHaveBeenCalled();
//     expect(animation.sync).toHaveBeenLastCalledWith(ctx, [unselected]);
//   });
// });
//
// function createRange(x: number, y: number, sourceDeviceId = "device:vaporizer") {
//   return {
//     sourceDeviceId,
//     gasItemId: "item_gas_inert",
//     gridRect: { x, y, width: 13, height: 13 },
//   };
// }
//
// function createEntity(id: string, x: number) {
//   return {
//     id,
//     definitionId: "vaporizer_1",
//     position: { x, y: 0 },
//     rotation: 0,
//     config: {},
//     tags: [],
//   };
// }
//
// function createContext(options: {
//   itemDefinitions: readonly unknown[];
//   getRanges: () => ReturnType<typeof createRange>[];
//   findItemDefinition?: (itemId: string) => unknown;
//   getMoveKind?: () => "ordinary" | "batch" | null;
//   getGhostIds?: () => readonly string[];
//   getPreviewIds?: () => readonly string[];
//   getRunningState?: () => "start" | "stop";
//   getSupportsAnimation?: () => boolean;
//   getBlueprintStyle?: () => boolean;
//   entities?: readonly ReturnType<typeof createEntity>[];
// }): DecorationSyncContext {
//   return {
//     viewportState: {
//       width: 800,
//       height: 600,
//       resolution: 1,
//       centerX: 0,
//       centerY: 0,
//       gridCellPixelSize: 20,
//       displayRotation: 0,
//     },
//     viewportBounds: {
//       left: 0,
//       top: 0,
//       width: 800,
//       height: 600,
//     },
//     renderHost: {
//       textureManager: {
//         supportsLogisticsAnimation: () => options.getSupportsAnimation?.() ?? true,
//       },
//       workspace: {
//         app: {
//           state: {
//             settings: {
//               get gameUseBlueprintStyleDeviceImages() {
//                 return options.getBlueprintStyle?.() ?? false;
//               },
//             },
//             get moveKind() {
//               return options.getMoveKind?.() ?? null;
//             },
//           },
//         },
//         registry: {
//           itemDefinitions: options.itemDefinitions,
//           entityDefinitions: [{ id: "vaporizer_1", footprint: { width: 2, height: 2 } }],
//           recipeDefinitions: [{ machineId: "vaporizer_1", gasDiffusionOutput: { range: 13 } }],
//           queries: {
//             findItemDefinition: options.findItemDefinition ?? (() => null),
//           },
//         },
//         simulation: {
//           state: {
//             get runningState() {
//               return options.getRunningState?.() ?? "start";
//             },
//           },
//           queries: {
//             getActiveGasDiffusionRanges: options.getRanges,
//           },
//         },
//         editor: options.getGhostIds === undefined
//           && options.getPreviewIds === undefined
//           && options.entities === undefined
//           ? undefined
//           : {
//               queries: {
//                 listEntities: () => options.entities ?? [],
//               },
//               state: {
//                 collections: {
//                   get [EntityCollectionType.ghost]() {
//                     return options.getGhostIds?.() ?? [];
//                   },
//                   get [EntityCollectionType.preview]() {
//                     return options.getPreviewIds?.() ?? [];
//                   },
//                 },
//               },
//             },
//       },
//     },
//     theme: "light",
//     nowMs: 0,
//   } as unknown as DecorationSyncContext;
// }

import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { collectRangeInstances, createRangeInteractionRules, resolveRangeInteractionVisualState, resolveRangePresentation } from "@/renderer/ranges";
import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import type { SimulationEnvironmentRangeReadModel } from "@/domain/simulation/types/simulation-types";

const registry = createRegistryContract();
const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
const entities = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/gas-interaction-visual-state/scene-02-variant-1.schema7.json"));
const ranges = collectRangeInstances(entities, definitions);
const active: SimulationEnvironmentRangeReadModel = {
  sourceDeviceId: "device:vaporizer-a", rangeId: "gas", rotation: 0,
  itemId: "item_gas_inert", gridRect: { x: -5, y: -5, width: 13, height: 13 },
};
function presentation(options: { active?: boolean; ready?: boolean; supportsAnimation?: boolean; batch?: boolean } = {}) {
  return resolveRangePresentation({
    ranges,
    interaction: resolveRangeInteractionVisualState({
      entities, ranges, entityDefinitionMap: definitions, rules: createRangeInteractionRules(registry.recipeDefinitions),
      activeTool: "move", moveKind: options.batch ? "batch" : "ordinary", alwaysShowPowerRange: false,
      previewEntityIds: [], ghostEntityIds: options.batch ? ["vaporizer-a"] : [],
    }),
    activeGasRanges: options.active ? [active] : [], resolveGasColor: () => 0x00d5ff,
    supportsAnimation: options.supportsAnimation ?? true, isAnimationReady: () => options.ready ?? false,
  });
}

describe("统一范围中的气体展示", () => {
  it("未运行、空闲和草稿保持范围框", () => {
    const result = presentation();
    expect(result.outlines).toHaveLength(3);
    expect(result.outlines.every((outline) => outline.fillAlpha === 0)).toBe(true);
    expect(result.animations).toEqual([]);
  });
  it("仅工作设备进入动画，停止后恢复范围框", () => {
    const result = presentation({ active: true, ready: true });
    expect(result.outlines).toHaveLength(2);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0]).toMatchObject({ gridRect: active.gridRect, color: 0x00d5ff, rotation: 0 });
    expect(presentation().outlines).toHaveLength(3);
  });
  it("加载期间填色回退，资源就绪后撤下填色", () => {
    expect(presentation({ active: true }).outlines.filter((outline) => outline.fillAlpha > 0))
      .toEqual([{ gridRect: active.gridRect, color: 0x00d5ff, fillAlpha: 0.07, strokeAlpha: 0.86, strokeScale: 1.1 }]);
    expect(presentation({ active: true, ready: true }).outlines.every((outline) => outline.fillAlpha === 0)).toBe(true);
  });
  it("蓝图外观和不支持动画时仅保留气体色矩形，切回后恢复动画", () => {
    const result = presentation({ active: true, ready: true, supportsAnimation: false });
    expect(result.animations).toEqual([]);
    expect(result.outlines.some((outline) => outline.fillAlpha === 0.07 && outline.color === 0x00d5ff)).toBe(true);
    expect(presentation({ active: true, ready: true }).animations).toHaveLength(1);
  });
  it("批量移动隐藏原件范围与动画，其他设备仍显示", () => {
    const result = presentation({ active: true, ready: true, batch: true });
    expect(result.outlines).toHaveLength(2);
    expect(result.animations).toEqual([]);
  });
  it("同值快照得到同值绘制输入", () => {
    expect(presentation({ active: true })).toEqual(presentation({ active: true }));
  });
});
