import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import {
  resolveBaseBoundaryGridRect, resolveBaseBoundaryGridRects, resolveBaseBoundaryStrokeWidth,
  resolveBaseNameplateAnchor, resolveBaseOuterGridRect, resolveBaseOuterGridRects, resolveExpandedGridRect,
} from "@/renderer/scene/decorations/BaseBoundaryDecoration";
import {
  resolveSceneBoundaryLines, resolveSceneOuterRects, resolveSceneViewportGridRect, resolveSceneWarningRects,
} from "@/renderer/scene/decorations/scene-space-layout";
import type { GridRotation } from "@/domain/shared/grid";

const registry = createRegistryContract();
const base = (id: string) => registry.baseDefinitions.find((value) => value.id === id)!;
const noRing = { top: 0, right: 0, bottom: 0, left: 0 };
const view = {
  viewportBounds: { left: 0, top: 0, width: 1000, height: 600 },
  viewportState: { width: 1000, height: 600, resolution: 1, centerX: 35, centerY: 10, gridCellPixelSize: 10, displayRotation: 0 as GridRotation },
};

describe("scene boundary and ground geometry", () => {
  it("preserves both agricultural nameplate anchors through pan and rotation", () => {
    const areas = resolveBaseAreas(base("wuling_agricultural_land"));
    expect(areas.map((area) => area.nameplate)).toEqual(["武陵农用地", "缘缘庄"]);
    const anchors = areas.map((area) => resolveBaseNameplateAnchor(area, view)!);
    expect(anchors.map((anchor) => anchor.x)).toEqual([-50, 990]);
    expect(anchors.every((anchor) => anchor.y < 80)).toBe(true);
    const moved = { ...view, viewportState: { ...view.viewportState, centerX: 37 } };
    expect(areas.map((area) => resolveBaseNameplateAnchor(area, moved)!.x)).toEqual([-70, 970]);
    const rotated = { ...moved, viewportState: { ...moved.viewportState, displayRotation: 90 as const } };
    const rotatedAnchors = areas.map((area) => resolveBaseNameplateAnchor(area, rotated)!);
    expect(rotatedAnchors.map((anchor) => anchor.x)).toEqual([-40, 20]);
    expect(rotatedAnchors[1]!.y - rotatedAnchors[0]!.y).toBe(1040);
    expect(resolveBaseNameplateAnchor(resolveBaseAreas(base("wuling_protocol_core"))[0]!, view)).toBeNull();
  });

  it.each([
    ["wuling_protocol_core", 80, 10], ["valley4_refugee_shelter", 40, 5], ["draft_box", 320, 20],
  ] as const)("keeps finite base dimensions and outer rings: %s", (id, size, ring) => {
    expect(resolveBaseBoundaryGridRect(base(id))).toEqual({ x: 0, y: 0, width: size, height: size });
    expect(resolveBaseBoundaryGridRects(base(id))).toEqual([{ x: 0, y: 0, width: size, height: size }]);
    const outer = { x: -ring, y: -ring, width: size + ring * 2, height: size + ring * 2 };
    expect(resolveBaseOuterGridRect(base(id))).toEqual(outer);
    expect(resolveBaseOuterGridRects(base(id))).toEqual([outer]);
    expect(resolveExpandedGridRect(outer, 2)).toEqual({ x: -ring - 2, y: -ring - 2, width: size + ring * 2 + 4, height: size + ring * 2 + 4 });
    expect(resolveBaseBoundaryStrokeWidth(10)).toBe(1.4375);
  });

  it.each([0, 90, 180, 270] as const)("clips rays without creating viewport borders at rotation %i", (rotation) => {
    const ctx = { ...view, viewportState: { ...view.viewportState, centerX: 0, centerY: 0, displayRotation: rotation } };
    const space = { areas: [{ id: "half-plane", bounds: { minX: null, maxX: null, minY: 0, maxY: null }, outerRing: noRing }] };
    const lines = resolveSceneBoundaryLines(space, ctx);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(Object.values(line.from).every(Number.isFinite)).toBe(true);
    expect(Object.values(line.to).every(Number.isFinite)).toBe(true);
    if (rotation === 0 || rotation === 180) {
      expect(line.from.y).toBe(300); expect(line.to.y).toBe(300);
    } else {
      expect(line.from.x).toBe(500); expect(line.to.x).toBe(500);
    }
    const viewport = resolveSceneViewportGridRect(ctx, 16, 16);
    const outer = resolveSceneOuterRects(space, viewport);
    expect(outer.every((rect) => Object.values(rect).every(Number.isFinite))).toBe(true);
    const warnings = resolveSceneWarningRects(space, viewport, 2);
    expect(warnings.every((rect) => rect.y === -2 && rect.height === 2)).toBe(true);
  });

  it("draws no boundary or warning for fully unbounded space, and keeps empty space empty", () => {
    const space = { areas: [{ id: "all", bounds: { minX: null, maxX: null, minY: null, maxY: null }, outerRing: noRing }] };
    const viewport = resolveSceneViewportGridRect(view, 16, 16);
    expect(resolveSceneBoundaryLines(space, view)).toEqual([]);
    expect(resolveSceneOuterRects(space, viewport)).toEqual([viewport]);
    expect(resolveSceneWarningRects(space, viewport, 2)).toEqual([]);
    expect(resolveSceneOuterRects({ areas: [] }, viewport)).toEqual([]);
    expect(resolveSceneBoundaryLines({ areas: [] }, view)).toEqual([]);
  });

  it("does not warn inside touching or overlapping regions", () => {
    const space = { areas: [
      { id: "a", bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 }, outerRing: noRing },
      { id: "b", bounds: { minX: 8, maxX: 20, minY: 0, maxY: 10 }, outerRing: noRing },
    ] };
    const warnings = resolveSceneWarningRects(space, { x: -5, y: -5, width: 30, height: 20 }, 2);
    expect(warnings.reduce((area, rect) => area + rect.width * rect.height, 0)).toBe(24 * 14 - 20 * 10);
    expect(warnings.some((rect) => rect.x <= 9 && rect.x + rect.width > 9 && rect.y <= 5 && rect.y + rect.height > 5)).toBe(false);
    const separated = { areas: [{ ...space.areas[0]!, bounds: { minX: 0, maxX: 5, minY: 0, maxY: 5 } }, { ...space.areas[1]!, bounds: { minX: 10, maxX: 15, minY: 0, maxY: 5 } }] };
    expect(resolveSceneOuterRects(separated, { x: -5, y: -5, width: 30, height: 20 })).toEqual([
      { x: 0, y: 0, width: 5, height: 5 }, { x: 10, y: 0, width: 5, height: 5 },
    ]);
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 旧测试模拟整套 Pixi 行为，矩形调用计数无法验证真实外缘或无界裁剪。
// Trigger: REQ-048 空间绘制从矩形描边迁为外缘线段；测试架构禁止继续扩展 Pixi mock。
// Evidence: 旧测试依赖 rectCommands，接缝和部分无界不能用完整矩形表示。
// Replacement: 上方纯几何、名牌锚点和并集警告测试；真实绘制纳入 REQ-048 临时 E2E。
// Risk: 浏览器绘制、名牌隐藏和资源销毁仍须真实浏览器验收，纯几何不能替代。
// Human Review: Required
// Original code:
// import { describe, expect, it, vi } from "vitest"
//
// interface MockGraphicsSnapshot {
//   readonly rectCommands: Array<{
//     x: number;
//     y: number;
//     width: number;
//     height: number;
//   }>;
//   readonly strokeCommands: unknown[];
//   readonly roundRectCommands: Array<{ x: number; y: number; width: number; height: number }>;
//   readonly children: MockTextSnapshot[];
//   clearCount: number;
// }
//
// interface MockTextSnapshot {
//   text: string;
//   visible: boolean;
//   x: number;
//   y: number;
//   readonly width: number;
//   readonly height: number;
// }
//
// const graphicsInstances = vi.hoisted(() => [] as MockGraphicsSnapshot[])
//
// vi.mock("pixi.js", () => {
//   class MockText implements MockTextSnapshot {
//     public text: string
//     public visible = true
//     public x = 0
//     public y = 0
//     public roundPixels = false
//     public eventMode = "none"
//     public resolution = 1
//     public readonly height = 18
//     public readonly position = { set: (x: number, y: number) => { this.x = x; this.y = y } }
//     public destroy = vi.fn()
//     public constructor(options: { text: string }) { this.text = options.text }
//     public get width() { return this.text.length * 14 }
//   }
//
//   class MockGraphics implements MockGraphicsSnapshot {
//     public readonly rectCommands: Array<{
//       x: number;
//       y: number;
//       width: number;
//       height: number;
//     }> = []
//     public readonly strokeCommands: unknown[] = []
//     public readonly roundRectCommands: Array<{ x: number; y: number; width: number; height: number }> = []
//     public readonly children: MockTextSnapshot[] = []
//     public clearCount = 0
//     public destroy = vi.fn()
//
//     public constructor() {
//       graphicsInstances.push(this)
//     }
//
//     public clear() {
//       this.clearCount += 1
//       this.rectCommands.length = 0
//       this.strokeCommands.length = 0
//       this.roundRectCommands.length = 0
//       return this
//     }
//
//     public rect(
//       x: number,
//       y: number,
//       width: number,
//       height: number,
//     ) {
//       this.rectCommands.push({ x, y, width, height })
//       return this
//     }
//
//     public stroke(style: unknown) {
//       this.strokeCommands.push(style)
//       return this
//     }
//
//     public addChild(text: MockTextSnapshot) { this.children.push(text); return text }
//     public roundRect(x: number, y: number, width: number, height: number) {
//       this.roundRectCommands.push({ x, y, width, height })
//       return this
//     }
//     public fill() { return this }
//   }
//
//   return {
//     BlurFilter: class {
//       public strength = 0
//       public destroy = vi.fn()
//     },
//     Graphics: MockGraphics,
//     Text: MockText,
//   }
// })
//
// import { createDummyWorldDocument } from "@/tests/helpers/dummy-document"
// import { AYU_LIGHT_THEME } from "@/app/theme"
// import { createRegistryContract } from "@/registry"
// import {
//   createBaseBoundaryDecoration,
//   resolveBaseBoundaryGridRect,
//   resolveBaseBoundaryGridRects,
//   resolveBaseBoundaryStrokeWidth,
//   resolveBaseOuterGridRect,
//   resolveBaseOuterGridRects,
//   resolveExpandedGridRect,
// } from "@/renderer/scene/decorations/BaseBoundaryDecoration"
// import type { DecorationSyncContext } from "@/renderer/scene/decorations/DecorationSyncContext"
//
// describe("BaseBoundaryDecoration", () => {
//   it("draws both agricultural nameplates above their outer warning rings and follows viewport changes", () => {
//     graphicsInstances.length = 0
//     const decoration = createBaseBoundaryDecoration()
//     const graphics = graphicsInstances[0]!
//     const ctx = createDecorationContext("wuling_agricultural_land")
//     ctx.viewportBounds.width = 1000
//     ctx.viewportBounds.height = 600
//     ctx.viewportState.centerX = 35
//     ctx.viewportState.centerY = 10
//
//     decoration.sync(ctx)
//     expect(graphics.rectCommands).toHaveLength(2)
//     expect(graphics.children.map((text) => text.text)).toEqual(["武陵农用地", "缘缘庄"])
//     expect(graphics.roundRectCommands.map((rect) => rect.x)).toEqual([-50, 990])
//     for (const plate of graphics.roundRectCommands) {
//       expect(plate.y + plate.height).toBeLessThan(80)
//     }
//     expect(graphics.children.every((text) => text.visible)).toBe(true)
//
//     decoration.sync(ctx)
//     expect(graphics.clearCount).toBe(1)
//     ctx.viewportState.centerX += 2
//     decoration.sync(ctx)
//     expect(graphics.roundRectCommands.map((rect) => rect.x)).toEqual([-70, 970])
//     expect(graphics.children).toHaveLength(2)
//
//     ctx.viewportState.displayRotation = 90
//     decoration.sync(ctx)
//     expect(graphics.roundRectCommands.map((rect) => rect.x)).toEqual([-40, 20])
//     expect(graphics.roundRectCommands[1]!.y - graphics.roundRectCommands[0]!.y).toBe(1040)
//     decoration.destroy()
//     expect((graphics as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy)
//       .toHaveBeenCalledWith({ children: true })
//   })
//
//   it("hides agricultural nameplates when switching to a base without names or an unknown base", () => {
//     graphicsInstances.length = 0
//     const decoration = createBaseBoundaryDecoration()
//     const graphics = graphicsInstances[0]!
//     decoration.sync(createDecorationContext("wuling_agricultural_land"))
//     decoration.sync(createDecorationContext("wuling_protocol_core"))
//     expect(graphics.roundRectCommands).toEqual([])
//     expect(graphics.children.every((text) => !text.visible)).toBe(true)
//     decoration.sync(createDecorationContext("wuling_agricultural_land"))
//     expect(graphics.children.every((text) => text.visible)).toBe(true)
//     decoration.sync(createDecorationContext("missing_base"))
//     expect(graphics.roundRectCommands).toEqual([])
//     expect(graphics.children.every((text) => !text.visible)).toBe(true)
//     decoration.destroy()
//   })
//
//   it("resolves the placeable area boundary without the outer ring", () => {
//     const registry = createRegistryContract()
//     const wuling = registry.baseDefinitions.find(
//       (definition) => definition.id === "wuling_protocol_core",
//     )
//     const valleyShelter = registry.baseDefinitions.find(
//       (definition) => definition.id === "valley4_refugee_shelter",
//     )
//
//     expect(wuling).toBeDefined()
//     expect(valleyShelter).toBeDefined()
//
//     if (wuling === undefined || valleyShelter === undefined) {
//       throw new Error("Expected base definitions to exist.")
//     }
//
//     expect(resolveBaseBoundaryGridRect(wuling)).toEqual({
//       x: 0,
//       y: 0,
//       width: 80,
//       height: 80,
//     })
//     expect(resolveBaseBoundaryGridRect(valleyShelter)).toEqual({
//       x: 0,
//       y: 0,
//       width: 40,
//       height: 40,
//     })
//   })
//
//   it("resolves the full outer expansion rect from placeable area and outer ring", () => {
//     const registry = createRegistryContract()
//     const wuling = registry.baseDefinitions.find(
//       (definition) => definition.id === "wuling_protocol_core",
//     )
//     const valleyShelter = registry.baseDefinitions.find(
//       (definition) => definition.id === "valley4_refugee_shelter",
//     )
//
//     expect(wuling).toBeDefined()
//     expect(valleyShelter).toBeDefined()
//
//     if (wuling === undefined || valleyShelter === undefined) {
//       throw new Error("Expected base definitions to exist.")
//     }
//
//     expect(resolveBaseOuterGridRect(wuling)).toEqual({
//       x: -10,
//       y: -10,
//       width: 100,
//       height: 100,
//     })
//     expect(resolveBaseOuterGridRect(valleyShelter)).toEqual({
//       x: -5,
//       y: -5,
//       width: 50,
//       height: 50,
//     })
//   })
//
//   it("draws only the draft box main boundaries", () => {
//     const draftBox = createRegistryContract().baseDefinitions.find(
//       (definition) => definition.id === "draft_box",
//     )!
//     // 当前零核心分区以 (-60, -60) 为原点，四侧各扩展 20 格；与 Registry 和 base-areas 契约一致。
//     // AI-CORRECTION 2026-09-28: 用户要求移除该分区，现在仅绘制主区域及其外环。
//     expect(resolveBaseBoundaryGridRects(draftBox)).toEqual([
//       { x: 0, y: 0, width: 320, height: 320 },
//       // AI-REMOVED 2026-09-28:
//       // Reason: 草稿箱取消左上角独立外环区。
//       // Trigger: 用户要求删除该区域并更新对应测试。
//       // Evidence: draft_box 改为仅保留主区域。
//       // Replacement: 当前数组仅保留主区域矩形。
//       // Risk: 原独立区域内已有设备将判定为越界。
//       // Human Review: Required
//       // Original code:
//       // { x: -80, y: -80, width: 40, height: 40 },
//     ])
//     expect(resolveBaseOuterGridRects(draftBox)).toEqual([
//       { x: -20, y: -20, width: 360, height: 360 },
//       // AI-REMOVED 2026-09-28:
//       // Reason: 草稿箱取消左上角独立外环区。
//       // Trigger: 用户要求删除该区域并更新对应测试。
//       // Evidence: draft_box 改为仅保留主区域。
//       // Replacement: 当前数组仅保留主区域矩形。
//       // Risk: 原独立区域内已有设备将判定为越界。
//       // Human Review: Required
//       // Original code:
//       // { x: -80, y: -80, width: 40, height: 40 },
//     ])
//   })
//
//   it("expands a grid rect symmetrically for the out-of-bounds warning ring", () => {
//     expect(resolveExpandedGridRect({
//       x: -5,
//       y: -5,
//       width: 90,
//       height: 90,
//     }, 2)).toEqual({
//       x: -7,
//       y: -7,
//       width: 94,
//       height: 94,
//     })
//   })
//
//   it("draws the current base boundary in viewport pixels", () => {
//     graphicsInstances.length = 0
//     const decoration = createBaseBoundaryDecoration()
//     const graphics = graphicsInstances[0]
//
//     decoration.sync(createDecorationContext("wuling_protocol_core"))
//
//     expect(graphics?.clearCount).toBe(1)
//     expect(graphics?.rectCommands).toHaveLength(1)
//     expect(graphics?.rectCommands[0]).toEqual({
//       x: 100,
//       y: 50,
//       width: 800,
//       height: 800,
//     })
//     expect(graphics?.strokeCommands[0]).toEqual({
//       width: resolveBaseBoundaryStrokeWidth(10),
//       color: 0xf2c94c,
//       alpha: 0.95,
//     })
//   })
//
//   it("clears without drawing when the current base is unknown", () => {
//     graphicsInstances.length = 0
//     const decoration = createBaseBoundaryDecoration()
//     const graphics = graphicsInstances[0]
//
//     decoration.sync(createDecorationContext("missing_base"))
//
//     expect(graphics?.clearCount).toBe(1)
//     expect(graphics?.rectCommands).toEqual([])
//     expect(graphics?.strokeCommands).toEqual([])
//   })
// })
//
// function createDecorationContext(baseId: string): DecorationSyncContext {
//   const registry = createRegistryContract()
//   const document = {
//     ...createDummyWorldDocument(),
//     baseId,
//   }
//
//   return {
//     viewportState: {
//       width: 200,
//       height: 100,
//       resolution: 1,
//       centerX: 0,
//       centerY: 0,
//       gridCellPixelSize: 10,
//       displayRotation: 0,
//     },
//     viewportBounds: {
//       left: 0,
//       top: 0,
//       width: 200,
//       height: 100,
//     },
//     theme: AYU_LIGHT_THEME,
//     renderHost: {
//       workspace: {
//         state: {} as never,
//         registry,
//         app: null,
//         editor: {
//           document: {
//             getSnapshot: () => document,
//             subscribe: () => () => undefined,
//           },
//         } as never,
//         render: null,
//         simulation: null,
//       } as never,
//       textureManager: {
//         getTexture: (async () => ({ width: 32, height: 32 })) as never,
//       } as never,
//     } as never,
//     nowMs: 0,
//   }
// }
