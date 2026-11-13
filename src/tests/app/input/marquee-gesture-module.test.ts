import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import type { CanvasRightDockToolbarItemRequest } from "@/app/state/state-impl";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import { WorkbenchOverlapEntityMenuController } from "@/app/shell/state/overlap-entity-menu-state";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import {
//   createHypergryphMarqueeGestureModule,
//   type GestureActionContext,
// } from "@/app/input/gesture/actions";
import { createGestureActionRouter, createHypergryphMarqueeGestureModule } from "@/app/input/gesture/actions";
// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import type { SceneSnapshotSource } from "@/domain/shared/scene-snapshot";

import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import type { RegistryContract } from "@/domain/registry/registry-contract";

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import {
//   EntityCollectionType,
//   type EntityCollection,
// } from "@/domain/editor/types/editor-types";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint } from "@/domain/shared/grid";
// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// import { createRegistryContract } from "@/registry";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphMarqueeGestureModule", () => {
  it("enters and exits marquee from the X key", () => {
    const { context, appHost, editor } = createContext({
      selectedEntityIds: ["entity-1"],
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent("KeyX"),
    })).toEqual({ status: "handled" });
    // AI-CORRECTION 2026-08-30: 匹配职责已移至 GestureActionRouter，模块不再调用 isShortcutFor。
    expect(appHost.internalActions.isShortcutFor).not.toHaveBeenCalled();
    expect(context.canvas.state.activeTool).toBe("marquee");
    expect(context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      [
        { operationId: "save-blueprint", presentation: "shortcut" },
        { operationId: "copy", presentation: "shortcut" },
        { operationId: "move", presentation: "shortcut" },
        { operationId: "delete", presentation: "shortcut" },
        { operationId: "toggle-marquee-selection", presentation: "shortcut" },
        { operationId: "marquee-select", presentation: "shortcut" },
        { operationId: "marquee-deselect", presentation: "shortcut" },
        { operationId: "exit-marquee", presentation: "shortcut" },
      ],
    );
    expect(context.canvas.state.runtime.canvasRightDockToolbar.items[0]?.presentation).toBe("shortcut");

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context,
      event: keyDownEvent("KeyX"),
    })).toEqual({ status: "handled" });
    expect(editor.actions.cancelMarquee).toHaveBeenCalledTimes(1);
    expect(editor.actions.clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(context.canvas.state.activeTool).toBe("select");
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
    expect(context.canvas.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
  });

  it("enters touch marquee from the placement button and collapses the right dock", () => {
    const { context, appHost } = createContext({
      selectedEntityIds: ["entity-1"],
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      uiButtonTouchTapEvent("placement-tool-marquee"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("marquee");
    expect(context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith([
      { operationId: "save-blueprint", presentation: "button" },
      { operationId: "copy", presentation: "button" },
      { operationId: "move", presentation: "button" },
      { operationId: "delete", presentation: "button" },
      { operationId: "toggle-marquee-selection", presentation: "button" },
      { operationId: "marquee-select", presentation: "button" },
      { operationId: "marquee-deselect", presentation: "button" },
      { operationId: "exit-marquee", presentation: "button" },
    ]);
    expect(context.canvas.state.runtime.canvasRightDockToolbar.items[0]?.presentation).toBe("button");
    expect(context.canvas.actions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      "canvas-top-left-corner-toolbar-button-toggle-pipe",
      "canvas-top-left-corner-toolbar-button-toggle-belt",
      "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
    ]);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
  });

  it("enters mouse marquee with shortcut mode toolbar from the placement button", () => {
    // AI-REMOVED 2026-11-12: Reason: 状态断言已改读 context.canvas，原绑定不再使用。
    // Trigger: REQ-048；Evidence: ESLint no-unused-vars；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      selectedEntityIds: ["entity-1"],
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("placement-tool-marquee"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("marquee");
    expect(context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith(
      [
        { operationId: "save-blueprint", presentation: "shortcut" },
        { operationId: "copy", presentation: "shortcut" },
        { operationId: "move", presentation: "shortcut" },
        { operationId: "delete", presentation: "shortcut" },
        { operationId: "toggle-marquee-selection", presentation: "shortcut" },
        { operationId: "marquee-select", presentation: "shortcut" },
        { operationId: "marquee-deselect", presentation: "shortcut" },
        { operationId: "exit-marquee", presentation: "shortcut" },
      ],
    );
    expect(context.canvas.state.runtime.canvasRightDockToolbar.items[0]?.presentation).toBe("shortcut");
  });

  it("shows selection action buttons only while the marquee selection is non-empty", () => {
    // AI-REMOVED 2026-11-12: Reason: 状态断言已改读 context.canvas，原绑定不再使用。
    // Trigger: REQ-048；Evidence: ESLint no-unused-vars；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost } = createContext({
    const { context } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();
    const entity = { id: "entity-1" } as WorldEntity;

    expect(module.handle(mouseTapEvent(entity), context)).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.canvasRightDockToolbar.items).toEqual([
      { operationId: "save-blueprint", presentation: "button" },
      { operationId: "copy", presentation: "button" },
      { operationId: "move", presentation: "button" },
      { operationId: "delete", presentation: "button" },
      { operationId: "toggle-marquee-selection", presentation: "button" },
      { operationId: "marquee-select", presentation: "button" },
      { operationId: "marquee-deselect", presentation: "button" },
      { operationId: "exit-marquee", presentation: "button" },
    ]);

    expect(module.handle(mouseTapEvent(entity), context)).toEqual({ status: "handled" });
    expect(context.canvas.state.runtime.canvasRightDockToolbar.items).toEqual([
      { operationId: "toggle-marquee-selection", presentation: "button" },
      { operationId: "marquee-select", presentation: "button" },
      { operationId: "marquee-deselect", presentation: "button" },
      { operationId: "exit-marquee", presentation: "button" },
    ]);
  });

  // AI-REMOVED 2026-08-22:
  // Reason: 框选测试改为验证逐项功能展示请求，不再验证按钮数组和工具列级 mode。
  // Trigger: showCanvasRightDockToolbar 契约重构为 operationId + presentation。
  // Evidence: 上述断言覆盖鼠标 shortcut、触控 button 与选区刷新后的 presentation 保持。
  // Replacement: 上述 items 断言。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // expect(appHost.internalState.runtime.canvasRightDockToolbar.mode).toBe("shortcut");
  // expect(appHost.internalState.runtime.canvasRightDockToolbar.mode).toBe("icon");
  // expect(appHost.internalState.runtime.canvasRightDockToolbar.buttonIds).toEqual([
  //   "canvas-right-dock-toolbar-button-exit",
  // ]);

  it("toggles the whole strict logistics segment when tapping a belt in marquee mode", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const beltA = entity("belt-a", "belt_straight_1x1", { x: 0, y: 0 });
    const beltB = entity("belt-b", "belt_straight_1x1", { x: 1, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const beltC = entity("belt-c", "belt_straight_1x1", { x: 2, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const pipe = entity("pipe-a", "pipe_straight_1x1", { x: 0, y: 1 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [beltA, beltB, beltC, pipe]
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/scene-01-variant-1.schema7.json"))),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(beltB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection].sort()).toEqual([
      "belt-a",
      "belt-b",
      "belt-c",
    ]);
    expect(editor.state.collections.selection.contains("pipe-a")).toBe(false);

    expect(module.handle(mouseTapEvent(beltB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection]).toEqual([]);
  });

  it("toggles the whole strict logistics segment when tapping a pipe in marquee mode", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const pipeA = entity("pipe-a", "pipe_straight_1x1", { x: 0, y: 0 });
    const pipeB = entity("pipe-b", "pipe_straight_1x1", { x: 1, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const pipeC = entity("pipe-c", "pipe_straight_1x1", { x: 2, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const belt = entity("belt-a", "belt_straight_1x1", { x: 0, y: 1 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [pipeA, pipeB, pipeC, belt]
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/scene-02-variant-1.schema7.json"))),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(pipeB), context)).toEqual({ status: "handled" });
    expect([...editor.state.collections.selection].sort()).toEqual([
      "pipe-a",
      "pipe-b",
      "pipe-c",
    ]);
    expect(editor.state.collections.selection.contains("belt-a")).toBe(false);
  });

  it("toggles the whole strict logistics segment from the overlap entity menu in marquee mode", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const beltA = entity("belt-a", "belt_straight_1x1", { x: 0, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const beltB = entity("belt-b", "belt_straight_1x1", { x: 1, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const beltC = entity("belt-c", "belt_straight_1x1", { x: 2, y: 0 });
    const pipe = entity("pipe-a", "pipe_straight_1x1", { x: 1, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [beltA, beltB, beltC, pipe]
    // AI-REMOVED 2026-11-12: Reason: 状态断言已改读 context.canvas，原绑定不再使用。
    // Trigger: REQ-048；Evidence: ESLint no-unused-vars；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost, editor } = createContext({
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/scene-03-variant-1.schema7.json"))),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(module.handle(mouseTapEvent(pipe, { x: 1, y: 0 }), context)).toEqual({ status: "handled" });
    expect(context.canvas.overlapEntityMenu.visible).toBe(true);
    expect(context.canvas.overlapEntityMenu.candidates.map((candidate) => candidate.entityId)).toEqual([
      "pipe-a",
      "belt-b",
    ]);
    expect(editor.actions.addToCollection).not.toHaveBeenCalled();

    context.canvas.overlapEntityMenu.select("belt-b");

    expect([...editor.state.collections.selection].sort()).toEqual([
      "belt-a",
      "belt-b",
      "belt-c",
    ]);
    expect(editor.state.collections.selection.contains("pipe-a")).toBe(false);
  });

  it("keeps marquee drag selection delegated to applyMarquee without expanding strict logistics segments", () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const beltA = entity("belt-a", "belt_straight_1x1", { x: 0, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/marquee-gesture-module/index.json
    // AI-CORRECTION 2026-09-14: 上述自动归档路径按仿真目录生成；实际替代场景索引为 src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json。
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // const beltB = entity("belt-b", "belt_straight_1x1", { x: 1, y: 0 });
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [beltA, beltB]
    const { context, editor } = createContext({
      activeTool: "marquee",
      document: createDocumentWithEntities(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/app/input/marquee-gesture-module/scene-04-variant-1.schema7.json"))),
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        mouseDragStartEvent({
          originButton: 0,
          pointerEntity: null,
          position: { x: 0, y: 0 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(module.handle(mouseDragEndEvent(), context).status).toBe("handled");

    expect(editor.actions.applyMarquee).toHaveBeenCalledTimes(1);
    expect(editor.actions.addToCollection).not.toHaveBeenCalled();
    expect(editor.actions.removeFromCollection).not.toHaveBeenCalled();
  });

  it("closes the left dock on marquee enter for mobile and tablet", () => {
    for (const deviceClass of ["mobile", "tablet"] as const) {
      const { context, appHost } = createContext({
        deviceClass,
        leftDockOpen: true,
      });
      const module = createHypergryphMarqueeGestureModule();

      expect(handleKeyboardShortcutThroughRouter({
        module,
        context,
        event: keyDownEvent("KeyX"),
      })).toEqual({ status: "handled" });
// AI-REMOVED 2026-11-12:
// Reason: 真实 Canvas adapter 在切换工具时已经发布 on-enter，旧手工事件会重复进入
// Trigger: REQ-048 静态预览及 Canvas 所有权迁移。
// Evidence: useReadonlyCanvas 固定采样，预览 Renderer 专用接口已退出。
// Replacement: 保留一次进入的调用次数、抑制状态与用户开关断言
// Risk: DOM 用例不证明 Canvas 像素；真实浏览器另行验证。
// Human Review: Required
// Original code:
//       expect(appHost.internalActions.setLeftDockSuppressed).not.toHaveBeenCalled();
//
//       expect(
//         module.handle(onEnterActiveToolEvent("select", "marquee"), context),
//       ).toEqual({ status: "handled" });

      expect(appHost.internalActions.setLeftDockSuppressed).toHaveBeenCalledTimes(1);
      expect(appHost.internalActions.setLeftDockSuppressed).toHaveBeenCalledWith(true);
      expect(appHost.state.workbench.leftDockOpen).toBe(true);
      expect(appHost.internalState.workbench.leftDockSuppressed).toBe(true);
    }
  });

  it("starts immediate mouse marquee from empty select drag start", () => {
    // AI-REMOVED 2026-11-12: Reason: 状态断言已改读 context.canvas，原绑定不再使用。
    // Trigger: REQ-048；Evidence: ESLint no-unused-vars；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost, editor } = createContext({
    const { context, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      mouseDragStartEvent({
        originButton: 0,
        pointerEntity: null,
        position: { x: 3.2, y: 4.8 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("marquee");
    expect(context.canvas.state.runtime.marqueeAnchor).toEqual({ x: 3, y: 4 });
    expect(context.canvas.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.marquee,
      { x: 3, y: 4, width: 1, height: 1 },
    );
  });

  it("starts immediate touch marquee from empty select long-press drag start", () => {
    const { context, appHost, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        longPress: true,
        pointerEntity: null,
        position: { x: 6.4, y: 7.9 },
      }),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(context.canvas.state.activeTool).toBe("marquee");
    expect(context.canvas.actions.showCanvasRightDockToolbar).toHaveBeenCalledWith([
      { operationId: "toggle-marquee-selection", presentation: "button" },
      { operationId: "marquee-select", presentation: "button" },
      { operationId: "marquee-deselect", presentation: "button" },
      { operationId: "exit-marquee", presentation: "button" },
    ]);
    expect(context.canvas.actions.showCanvasTopLeftCornerToolbar).toHaveBeenCalledWith([
      "canvas-top-left-corner-toolbar-button-toggle-pipe",
      "canvas-top-left-corner-toolbar-button-toggle-belt",
      "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
    ]);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
    expect(context.canvas.state.runtime.marqueeAnchor).toEqual({ x: 6, y: 7 });
    expect(context.canvas.state.toolInfo.marqueeType).toBe(EntityCollectionType.marquee);
    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.marquee,
      { x: 6, y: 7, width: 1, height: 1 },
    );
  });

  it("does not claim touch long-press drag from an entity when immediate marquee is enabled", () => {
    // AI-REMOVED 2026-11-12: Reason: 状态断言已改读 context.canvas，原绑定不再使用。
    // Trigger: REQ-048；Evidence: ESLint no-unused-vars；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost, editor } = createContext({
    const { context, editor } = createContext({
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      touchDragStartEvent({
        longPress: true,
        pointerEntity: { id: "entity-1" } as WorldEntity,
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(context.canvas.state.activeTool).toBe("select");
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
  });

  it("uses right mouse drag for reverse marquee and applies on drag end", () => {
    // AI-REMOVED 2026-11-12: Reason: 状态断言已改读 context.canvas，原绑定不再使用。
    // Trigger: REQ-048；Evidence: ESLint no-unused-vars；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost, editor } = createContext({
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        mouseDragStartEvent({
          originButton: 2,
          pointerEntity: null,
          position: { x: 5.1, y: 5.1 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(context.canvas.state.toolInfo.marqueeType).toBe(EntityCollectionType.reverseMarquee);

    expect(
      module.handle(
        mouseDragMoveEvent({
          position: { x: 2.9, y: 3.2 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(editor.actions.setMarqueeRange).toHaveBeenLastCalledWith(
      EntityCollectionType.reverseMarquee,
      { x: 2, y: 3, width: 4, height: 3 },
    );

    expect(module.handle(mouseDragEndEvent(), context)).toEqual({ status: "handled" });
    expect(editor.actions.applyMarquee).toHaveBeenCalledTimes(1);
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
  });

  it("ignores middle mouse drag and non-long-press touch drag", () => {
    // AI-REMOVED 2026-11-12: Reason: 状态断言已改读 context.canvas，原绑定不再使用。
    // Trigger: REQ-048；Evidence: ESLint no-unused-vars；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost, editor } = createContext({
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    const middleMouseResult = module.handle(
      mouseDragStartEvent({
        originButton: 1,
        pointerEntity: null,
      }),
      context,
    );
    const touchResult = module.handle(
      touchDragStartEvent({
        longPress: false,
      }),
      context,
    );

    expect(middleMouseResult).toEqual({ status: "ignored" });
    expect(touchResult).toEqual({ status: "ignored" });
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
  });

  it("does not enter marquee on middle mouse drag even when immediate marquee is enabled", () => {
    // AI-REMOVED 2026-11-12: Reason: 状态断言已改读 context.canvas，原绑定不再使用。
    // Trigger: REQ-048；Evidence: ESLint no-unused-vars；Replacement: context.canvas；Risk: Low；Human Review: Required
    // Original code: const { context, appHost, editor } = createContext({
    const { context, editor } = createContext({
      activeTool: "select",
      hypergryphImmediateMarquee: true,
    });
    const module = createHypergryphMarqueeGestureModule();

    const result = module.handle(
      mouseDragStartEvent({
        originButton: 1,
        pointerEntity: null,
        position: { x: 5, y: 5 },
      }),
      context,
    );

    expect(result).toEqual({ status: "ignored" });
    expect(context.canvas.state.activeTool).toBe("select");
    expect(context.canvas.state.runtime.marqueeAnchor).toBeNull();
    expect(editor.actions.setMarqueeRange).not.toHaveBeenCalled();
  });

  it("uses the top-left toggle state for touch reverse marquee", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-on"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(
      module.handle(
        touchDragStartEvent({
          longPress: true,
          position: { x: 8.4, y: 9.7 },
        }),
        context,
      ),
    ).toEqual({ status: "handled" });

    expect(editor.actions.setMarqueeRange).toHaveBeenCalledWith(
      EntityCollectionType.reverseMarquee,
      { x: 8, y: 9, width: 1, height: 1 },
    );

    expect(
      module.handle(
        uiButtonMouseTapEvent("canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-off"),
        context,
      ),
    ).toEqual({ status: "handled" });
  });

  it("resets logistics suppression when exiting marquee", () => {
    const { context, editor } = createContext({
      activeTool: "marquee",
    });
    const module = createHypergryphMarqueeGestureModule();
    // 2026-11-12：退出清理由 on-exit owner 执行，装配实际路由以接收工具状态变化。
    const router = createGestureActionRouter({ gestureAdapter: context.canvas.gestureAdapter,
      workspace: context.workspace, getAppHost: () => context.appHost,
      getCanvas: () => context.canvas, modules: [module] });
    cleanups.push(() => router.dispose());
    const setLogisticsSuppression = vi.mocked(editor.actions.setLogisticsSuppression);

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-top-left-corner-toolbar-button-toggle-belt-on"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(setLogisticsSuppression).toHaveBeenLastCalledWith("belt", true);

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-exit"),
        context,
      ),
    ).toEqual({ status: "handled" });
    expect(setLogisticsSuppression.mock.calls.slice(-2)).toEqual([
      ["belt", false],
      ["pipe", false],
    ]);
  });

  it("handles the exit right dock button without restoring the right dock", () => {
    const exitContext = createContext({
      activeTool: "marquee",
      marqueeAnchor: { x: 1, y: 1 },
      rightDockOpen: false,
    });
    const module = createHypergryphMarqueeGestureModule();
    // 2026-11-12：退出清理由 on-exit owner 执行，装配实际路由以接收工具状态变化。
    const router = createGestureActionRouter({ gestureAdapter: exitContext.context.canvas.gestureAdapter,
      workspace: exitContext.context.workspace, getAppHost: () => exitContext.context.appHost,
      getCanvas: () => exitContext.context.canvas, modules: [module] });
    cleanups.push(() => router.dispose());

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-right-dock-toolbar-button-exit"),
        exitContext.context,
      ),
    ).toEqual({ status: "handled" });
    expect(exitContext.editor.actions.cancelMarquee).toHaveBeenCalledTimes(1);
    expect(exitContext.editor.actions.clearCollection).toHaveBeenCalledWith(EntityCollectionType.selection);
    expect(exitContext.context.canvas.state.activeTool).toBe("select");
    expect(exitContext.appHost.internalState.workbench.rightDockOpen).toBe(false);
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// function createContext(options: {
//   activeTool?: "select" | "move" | "marquee" | "single-placement";
//   hypergryphImmediateMarquee?: boolean;
//   marqueeAnchor?: GridPoint | null;
//   rightDockOpen?: boolean;
//   leftDockOpen?: boolean;
//   deviceClass?: "desktop" | "tablet" | "mobile";
//   selectedEntityIds?: readonly string[];
//   document?: WorldDocument;
//   registry?: RegistryContract;
// } = {}): {
//   context: GestureActionContext<AppHost>;
//   editor: MockEditor;
//   appHost: AppHost;
// } {
//   const selection = createSelectionCollection(options.selectedEntityIds ?? []);
//   const mutableSelection = selection as unknown as string[];
//   const documentSnapshot = options.document ?? createDocumentWithEntities([]);
//   const editor: MockEditor = {
//     document: {
//       getSnapshot: vi.fn(() => documentSnapshot),
//     } as unknown as SceneSnapshotSource<WorldDocument>,
//     state: {
//       collections: {
//         selection,
//       },
//     } as EditorContract["state"],
//     actions: {
//       setMarqueeRange: vi.fn(),
//       applyMarquee: vi.fn(),
//       cancelMarquee: vi.fn(),
//       clearCollection: vi.fn((collectionType) => {
//         if (collectionType === EntityCollectionType.selection) {
//           mutableSelection.splice(0, mutableSelection.length);
//         }
//       }),
//       addToCollection: vi.fn(({ collectionType, entityId }) => {
//         if (
//           collectionType === EntityCollectionType.selection
//           && !selection.includes(entityId)
//         ) {
//           mutableSelection.push(entityId);
//         }
//       }),
//       removeFromCollection: vi.fn(({ collectionType, entityId }) => {
//         if (collectionType !== EntityCollectionType.selection) {
//           return;
//         }
//
//         const index = selection.indexOf(entityId);
//         if (index >= 0) {
//           mutableSelection.splice(index, 1);
//         }
//       }),
//       setLogisticsSuppression: vi.fn(),
//       setHoverPoint: vi.fn(),
//       clearHoverPoint: vi.fn(),
//     },
//     queries: {
//       getEntityById: vi.fn((entityId) => documentSnapshot.entities[entityId] ?? null),
//       listEntities: vi.fn(() => documentSnapshot.entityOrder.flatMap((entityId) => {
//         const currentEntity = documentSnapshot.entities[entityId];
//         return currentEntity === undefined ? [] : [currentEntity];
//       })),
//       findGridCellForClientPixelPoint: vi.fn((point) => ({
//         x: Math.floor(point.x),
//         y: Math.floor(point.y),
//       })),
//     },
//   };
//   const toolInfo = {
//     marqueeType: EntityCollectionType.marquee,
//   };
//   const workbenchState = {
//     leftDockOpen: options.leftDockOpen ?? true,
//     leftDockSuppressed: false,
//     rightDockOpen: options.rightDockOpen ?? true,
//   };
//   const workspace = {
//     editor,
//     registry: options.registry ?? createRegistryContract(),
//   } as unknown as WorkspaceContract;
//   const appHost = {
//     workspace,
//     state: {
//       settings: {
//         // AI-REMOVED 2026-09-10:
//         // Reason: 操作模式总开关已废弃，不再保留关闭分支
//         // Trigger: 用户要求彻底移除 hypergryphOperationMode。
//         // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
//         // Replacement: 测试状态不再需要模式字段
//         // Risk: 历史 false 设置统一使用当前操作行为。
//         // Human Review: Required
//         //
//         // Original code:
//         // hypergryphOperationMode: true,
//         hypergryphImmediateMarquee: options.hypergryphImmediateMarquee ?? false,
//       },
//       toolInfo,
//       screenProfile: {
//         deviceClass: options.deviceClass ?? "desktop",
//       },
//       workbench: workbenchState,
//     },
//     internalState: {
//       activeTool: options.activeTool ?? "select",
//       toolInfo,
//       workbench: workbenchState,
//       runtime: {
//         moveAnchor: null,
//         marqueeAnchor: options.marqueeAnchor ?? null,
//         canvasRightDockToolbar: {
//           visible: false,
//           items: [] as CanvasRightDockToolbarItemRequest[],
//         },
//         canvasTopLeftCornerToolbar: {
//           visible: false,
//           buttonIds: [],
//         },
//       },
//     },
//     internalActions: {
//       isShortcutFor: vi.fn((shortcutId, code) => (
//         shortcutId === SHORTCUT_KEY.MARQUEE && code === "KeyX"
//       )),
//       setActiveTool: vi.fn((activeTool) => {
//         appHost.internalState.activeTool = activeTool;
//       }),
//       setLeftDockSuppressed: vi.fn((suppressed) => {
//         appHost.internalState.workbench.leftDockSuppressed = suppressed;
//       }),
//       toggleRightDock: vi.fn(() => {
//         appHost.internalState.workbench.rightDockOpen =
//           !appHost.internalState.workbench.rightDockOpen;
//       }),
//       showCanvasRightDockToolbar: vi.fn((items: readonly CanvasRightDockToolbarItemRequest[]) => {
//         appHost.internalState.runtime.canvasRightDockToolbar.visible = true;
//         appHost.internalState.runtime.canvasRightDockToolbar.items = [...items];
//       }),
//       hideCanvasRightDockToolbar: vi.fn(() => {
//         appHost.internalState.runtime.canvasRightDockToolbar.visible = false;
//         appHost.internalState.runtime.canvasRightDockToolbar.items = [];
//       }),
//       showCanvasTopLeftCornerToolbar: vi.fn((buttonIds) => {
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.visible = true;
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [...buttonIds];
//       }),
//       hideCanvasTopLeftCornerToolbar: vi.fn(() => {
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.visible = false;
//         appHost.internalState.runtime.canvasTopLeftCornerToolbar.buttonIds = [];
//       }),
//     },
//     overlapEntityMenu: new WorkbenchOverlapEntityMenuController(),
//   } as unknown as AppHost;
//
//   return {
//     context: {
//       workspace,
//       appHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     editor,
//     appHost,
//   };
// }
function createContext(options: { activeTool?: "select" | "move" | "marquee" | "single-placement"; hypergryphImmediateMarquee?: boolean; marqueeAnchor?: GridPoint | null;
  rightDockOpen?: boolean; leftDockOpen?: boolean; deviceClass?: "desktop" | "tablet" | "mobile"; selectedEntityIds?: readonly string[]; document?: WorldDocument } = {}) {
  const test = createCanvasTestSession({ activeTool: options.activeTool,
    document: options.document ?? createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-belt.schema7.json")),
    viewport: { center: { x: 50, y: 50 }, gridSize: 1 / 16, displayRotation: 0 } }); cleanups.push(test.dispose);
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 100, height: 100 });
  test.app.internalActions.setScreenProfile({ ...test.app.state.screenProfile, deviceClass: options.deviceClass ?? "desktop" });
  test.app.internalState.settings.hypergryphImmediateMarquee = options.hypergryphImmediateMarquee ?? false;
  test.app.internalState.workbench.leftDockOpen = options.leftDockOpen ?? true;
  test.app.internalState.workbench.rightDockOpen = options.rightDockOpen ?? true;
  test.canvas.state.runtime.marqueeAnchor = options.marqueeAnchor ?? null;
  for (const entityId of options.selectedEntityIds ?? []) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  for (const key of ["setMarqueeRange", "applyMarquee", "cancelMarquee", "clearCollection", "addToCollection", "removeFromCollection", "setLogisticsSuppression", "setHoverPoint", "clearHoverPoint"] as const) vi.spyOn(test.editor.actions, key);
  for (const key of ["setActiveTool", "showCanvasRightDockToolbar", "hideCanvasRightDockToolbar", "showCanvasTopLeftCornerToolbar", "hideCanvasTopLeftCornerToolbar"] as const) vi.spyOn(test.canvas.actions, key);
  for (const key of ["setLeftDockSuppressed", "toggleRightDock", "isShortcutFor"] as const) vi.spyOn(test.app.internalActions, key);
  return { context: test.context, editor: test.editor, appHost: test.app };
}

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// type MockEditor = {
//   document: Pick<EditorContract["document"], "getSnapshot">;
//   state: Pick<EditorContract["state"], "collections">;
//   actions: Pick<
//     EditorContract["actions"],
//     | "applyMarquee"
//     | "cancelMarquee"
//     | "clearCollection"
//     | "addToCollection"
//     | "removeFromCollection"
//     | "setMarqueeRange"
//     | "setLogisticsSuppression"
//     | "setHoverPoint"
//     | "clearHoverPoint"
//   >;
//   queries: Pick<
//     EditorContract["queries"],
//     | "findGridCellForClientPixelPoint"
//     | "getEntityById"
//     | "listEntities"
//   >;
// };


// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// function createSelectionCollection(entityIds: readonly string[]): EntityCollection {
//   const selection = [...entityIds] as string[] & EntityCollection;
//   selection.contains = (entityId: string) => selection.includes(entityId);
//   return selection;
// }


function createDocumentWithEntities(entities: readonly WorldEntity[]): WorldDocument {
  const document = createWorldDocument();
  return {
    ...document,
    entities: Object.fromEntries(entities.map((currentEntity) => [
      currentEntity.id,
      currentEntity,
    ])),
    entityOrder: entities.map((currentEntity) => currentEntity.id),
  };
}

function entity(
  id: string,
  definitionId = "grinder_1",
  position: GridPoint = { x: 0, y: 0 },
): WorldEntity {
  return {
    id,
    definitionId,
    position,
    rotation: 0,
    config: {},
    tags: [],
  };
}

function keyDownEvent(code: string) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code,
    key: code === "Escape" ? "Escape" : code.replace("Key", "").toLowerCase(),
    keyCode: code === "Escape" ? 27 : code.replace("Key", "").charCodeAt(0),
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: `ui-touch-${uiButtonId}`,
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: `ui-mouse-${uiButtonId}`,
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseTapEvent(pointerEntity: WorldEntity, position: GridPoint = { x: 2, y: 2 }) {
  return {
    type: "mouse tap" as const,
    gestureId: `mouse-tap-${pointerEntity.id}`,
    button: 0,
    buttons: 0,
    position,
    longPress: false,
    pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragStartEvent(options: {
  originButton: number;
  pointerEntity: WorldEntity | null;
  position?: GridPoint;
}) {
  return {
    type: "mouse dragstart" as const,
    gestureId: "mouse-drag-1",
    originButton: options.originButton,
    button: options.originButton,
    buttons: 1,
    position: options.position ?? { x: 2, y: 2 },
    startPosition: options.position ?? { x: 2, y: 2 },
    longPress: false,
    pointerEntity: options.pointerEntity,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragMoveEvent(options: {
  position: GridPoint;
}) {
  return {
    type: "mouse dragmove" as const,
    gestureId: "mouse-drag-1",
    originButton: 2,
    buttons: 2,
    position: options.position,
    delta: { x: 1, y: 1 },
    longPress: false,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function mouseDragEndEvent() {
  return {
    type: "mouse dragend" as const,
    gestureId: "mouse-drag-1",
    originButton: 2,
    releaseButton: 2,
    button: 2,
    buttons: 0,
    position: { x: 2, y: 3 },
    reason: "release" as const,
    longPress: false,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function touchDragStartEvent(options: {
  longPress: boolean;
  position?: GridPoint;
  pointerEntity?: WorldEntity | null;
}) {
  return {
    type: "touch dragstart" as const,
    gestureId: "touch-drag-1",
    primaryId: 1,
    position: options.position ?? { x: 2, y: 2 },
    startPosition: options.position ?? { x: 2, y: 2 },
    activeTouchCount: 1,
    longPress: options.longPress,
    pointerEntity: options.pointerEntity ?? null,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 框选测试的业务桩依赖退出的 App/Editor 相机字段。
// Trigger: REQ-048 Canvas/View 迁移。
// Evidence: 真实模块读取 context.canvas 的工具和相机。
// Replacement: createCanvasTestSession 与真实动作的 call-through spies。
// Risk: 断言保持；旧假坐标查询由一格一像素的真实 View 代替。
// Human Review: Required
// Original code:
// function emptyKeyboardSnapshot(): KeyboardSnapshot {
//   return {
//     pressedKeys: new Set(),
//     lastCode: null,
//     lastKey: null,
//     lastKeyCode: null,
//     modifiers: emptyModifiers(),
//   };
// }


// AI-REMOVED 2026-11-12:
// Reason: 真实 adapter 自动发布工具进入事件，不再重复手工构造。
// Trigger: REQ-048 Canvas 输入生命周期迁移。
// Evidence: 唯一调用已迁移到真实工具切换。
// Replacement: createGestureAdapter activeTool reaction。
// Risk: Low
// Human Review: Required
// Original code:
// function onEnterActiveToolEvent(
//   from: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
//   to: "select" | "move" | "marquee" | "single-placement" | "logistics-placement",
// ) {
//   return {
//     type: "on-enter-active-tool" as const,
//     gestureId: "enter-active-tool-1",
//     from,
//     to,
//     modifiers: emptyModifiers(),
//     sourceEvent: null,
//   };
// }

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}
