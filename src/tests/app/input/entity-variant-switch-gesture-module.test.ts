import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
// AI-REMOVED 2026-11-12:
// Reason: 空文档工厂不会导入蓝图实体。
// Trigger: REQ-048 测试装配迁移；Evidence: createWorldDocument 只接受 baseId。
// Replacement: createWorldDocumentFromBlueprint
// Risk: Low；Human Review: Required
// Original code:
// import { createWorldDocument } from "@/domain/document/world-document";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import { SHORTCUT_KEY } from "@/app/actions";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import {
//   createHypergryphEntityVariantSwitchGestureModule,
//   type GestureActionContext,
// } from "@/app/input/gesture/actions";
import { createHypergryphEntityVariantSwitchGestureModule } from "@/app/input/gesture/actions";
// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";
// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import { createRegistryContract } from "@/registry";

import { handleKeyboardShortcutThroughRouter } from "./shortcut-route-test-helper";

describe("createHypergryphEntityVariantSwitchGestureModule", () => {
  it("switches a single selected device from the inspector action button", () => {
    const { context, editor } = createContext();
    const module = createHypergryphEntityVariantSwitchGestureModule();

    const result = module.handle(
      uiButtonMouseTapEvent("canvas-floating-toolbar-button-switch-mode"),
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "selected-entity",
      "filling_pd_mc_1_liquid",
    );
  });

  it("switches from Tab only in select mode with the right Inspector panel", () => {
    const panel = createContext({ useInspectorPanel: true });
    const dialog = createContext({ useInspectorPanel: false });
    const marquee = createContext({ activeTool: "marquee", useInspectorPanel: true });
    const module = createHypergryphEntityVariantSwitchGestureModule();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: panel.context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "handled" });
    expect(panel.editor.actions.replaceEntityDefinition).toHaveBeenCalledWith(
      "selected-entity",
      "filling_pd_mc_1_liquid",
    );

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: dialog.context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "ignored" });
    expect(dialog.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();

    expect(handleKeyboardShortcutThroughRouter({
      module,
      context: marquee.context,
      event: keyDownEvent({ code: "Tab", key: "Tab" }),
    })).toEqual({ status: "ignored" });
    expect(marquee.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });

  it("ignores non-switchable or multi-selected devices", () => {
    const nonSwitchable = createContext({
      selectedDefinitionId: "belt_straight_1x1",
    });
    const multi = createContext({
      activeTool: "marquee",
      selectionIds: ["selected-entity", "other-entity"],
    });
    const module = createHypergryphEntityVariantSwitchGestureModule();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"),
        nonSwitchable.context,
      ),
    ).toEqual({ status: "ignored" });
    expect(nonSwitchable.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();

    expect(
      module.handle(
        uiButtonTouchTapEvent("canvas-floating-toolbar-button-switch-mode"),
        multi.context,
      ),
    ).toEqual({ status: "ignored" });
    expect(multi.editor.actions.replaceEntityDefinition).not.toHaveBeenCalled();
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: createContext / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// function createContext(options: {
//   activeTool?: "select" | "marquee" | "move";
//   selectedDefinitionId?: string;
//   selectionIds?: readonly string[];
//   useInspectorPanel?: boolean;
// } = {}): {
//   context: GestureActionContext<AppHost>;
//   editor: MockEditor;
// } {
//   const selection = createCollection(options.selectionIds ?? ["selected-entity"]);
//   const entity: WorldEntity = {
//     id: "selected-entity",
//     definitionId: options.selectedDefinitionId ?? "filling_pd_mc_1",
//     position: { x: 0, y: 0 },
//     rotation: 0,
//     config: { keep: true },
//     tags: [],
//   };
//   const registry = createRegistryContract();
//   const editor: MockEditor = {
//     // AI-CORRECTION 2026-10-12: 地图资格不再允许未知文档；旧路由布景显式提供已加载地图的完整快照。
//     document: { getSnapshot: () => createWorldDocument({ baseId: "wuling_protocol_core" }) },
//     state: {
//       collections: {
//         [EntityCollectionType.selection]: selection,
//         [EntityCollectionType.marquee]: createCollection([]),
//         [EntityCollectionType.reverseMarquee]: createCollection([]),
//         [EntityCollectionType.preview]: createCollection([]),
//         [EntityCollectionType.ghost]: createCollection([]),
//         [EntityCollectionType.logisticsHead]: createCollection([]),
//         [EntityCollectionType.powered]: createCollection([]),
//         [EntityCollectionType.invalidPlacement]: createCollection([]),
//       },
//     },
//     queries: {
//       getEntityById: vi.fn((entityId: string) =>
//         entityId === entity.id ? entity : null,
//       ),
//     },
//     actions: {
//       replaceEntityDefinition: vi.fn((entityId: string, nextDefinitionId: string) => {
//         if (entityId !== entity.id) {
//           return false;
//         }
//
//         entity.definitionId = nextDefinitionId;
//         entity.config = {};
//         return true;
//       }),
//     },
//   };
//   const appHost = {
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
//         gameUseInspectorPanel: options.useInspectorPanel ?? false,
//       },
//     },
//     internalState: {
//       activeTool: options.activeTool ?? "select",
//     },
//     internalActions: {
//       isShortcutFor: vi.fn((
//         shortcutKey: string,
//         code: string | null,
//         eventKey: string | null,
//       ) => (
//         shortcutKey === SHORTCUT_KEY.SWITCH_DEVICE_MODE
//         && code === "Tab"
//         && eventKey === "Tab"
//       )),
//     },
//     workspace: {
//       editor,
//       registry,
//     },
//   } as unknown as AppHost;
//
//   return {
//     context: {
//       workspace: {
//         editor,
//         registry,
//       } as unknown as WorkspaceContract,
//       appHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     editor,
//   };
// }
function createContext(options: { activeTool?: "select" | "marquee" | "move"; selectedDefinitionId?: string; selectionIds?: readonly string[]; useInspectorPanel?: boolean } = {}) {
  const variant = options.selectedDefinitionId === "belt_straight_1x1" ? "belt" : "device";
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-" + variant + ".schema7.json");
  const test = createCanvasTestSession({ document: createWorldDocumentFromBlueprint(blueprint), activeTool: options.activeTool }); cleanups.push(test.dispose);
  test.app.internalState.settings.gameUseInspectorPanel = options.useInspectorPanel ?? false;
  for (const entityId of options.selectionIds ?? ["selected-entity"]) test.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId });
  vi.spyOn(test.editor.actions, "replaceEntityDefinition");
  return { context: test.context, editor: test.editor };
}

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: MockCollection / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// type MockCollection = string[] & {
//   contains(entityId: string): boolean;
//   replace(entityIds: readonly string[]): void;
// };


// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: MockEditor / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// type MockEditor = {
//   document: Pick<EditorContract["document"], "getSnapshot">;
//   state: Pick<EditorContract["state"], "collections">;
//   actions: Pick<EditorContract["actions"], "replaceEntityDefinition">;
//   queries: Pick<EditorContract["queries"], "getEntityById">;
// };


// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: createCollection / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// function createCollection(entityIds: readonly string[]): MockCollection {
//   const collection = [...entityIds] as MockCollection;
//   collection.contains = (entityId: string) => collection.includes(entityId);
//   collection.replace = (nextEntityIds: readonly string[]) => {
//     collection.splice(0, collection.length, ...nextEntityIds);
//   };
//   return collection;
// }


function uiButtonTouchTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-touch-tap" as const,
    gestureId: "ui-touch-tap-1",
    uiButtonId,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function uiButtonMouseTapEvent(uiButtonId: string) {
  return {
    type: "ui-button-mouse-tap" as const,
    gestureId: "ui-mouse-tap-1",
    uiButtonId,
    button: 0,
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function keyDownEvent(options: { code: string | null; key: string | null }) {
  return {
    type: "key down" as const,
    gestureId: "key-down-1",
    code: options.code,
    key: options.key,
    keyCode: options.key === null ? null : options.key.toUpperCase().charCodeAt(0),
    modifiers: emptyModifiers(),
    sourceEvent: null,
  };
}

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: emptyKeyboardSnapshot / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
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
