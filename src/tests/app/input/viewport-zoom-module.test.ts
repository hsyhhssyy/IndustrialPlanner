import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
import { afterEach, describe, expect, it, vi } from "vitest";

// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";

// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
// Human Review: Required
// Original code:
// import type { KeyboardSnapshot } from "@/app/input/gesture/adapter";

// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
// Human Review: Required
// Original code:
// import {
//   createHypergryphViewportZoomModule,
//   type GestureActionContext,
// } from "@/app/input/gesture/actions";
import { createHypergryphViewportZoomModule } from "@/app/input/gesture/actions";
// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
// Human Review: Required
// Original code:
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";

// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";
// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
// Human Review: Required
// Original code:
// import type { GridRect } from "@/domain/shared/grid";


describe("createHypergryphViewportZoomModule", () => {
  it("nudges a mobile placement preview back into the safe viewport after pinch zoom", () => {
    const {
      context,
      moveCollectionTo,
      previewRectRef,
      zoom,
    } = createMobilePlacementContext();
    const module = createHypergryphViewportZoomModule();

    const result = module.handle(
      {
        type: "pinch out",
        gestureId: "pinch-preview-1",
        center: { x: 5, y: 5 },
        scaleDelta: 2,
        distanceDelta: 10,
        activeTouchCount: 2,
        modifiers: emptyModifiers(),
        sourceEvent: null,
      },
      context,
    );

    expect(result).toEqual({ status: "handled" });
    expect(zoom).toHaveBeenCalledWith(4);
    expect(moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 20, y: 0 },
      endGridPoint: { x: 3, y: 0 },
    });
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(context.canvas.state.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
// Human Review: Required
// Original code:
// function createMobilePlacementContext(): {
//   context: GestureActionContext<AppHost>;
//   moveCollectionTo: ReturnType<typeof vi.fn>;
//   previewRectRef: { current: GridRect };
//   zoom: ReturnType<typeof vi.fn>;
// } {
//   const previewRectRef = {
//     current: { x: 20, y: 0, width: 2, height: 2 },
//   };
//   const zoom = vi.fn();
//   const moveCollectionTo = vi.fn(({ startGridPoint, endGridPoint }) => {
//     previewRectRef.current = {
//       ...previewRectRef.current,
//       x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
//       y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
//     };
//   });
//   const editor = {
//     state: {
//       viewport: {
//         center: { x: 0, y: 0 },
//         clientRect: { left: 0, top: 0, width: 10, height: 10 },
//         gridSize: 1,
//         gridCellPixelSize: 1,
//         displayRotation: 0,
//       },
//       collections: {
//         [EntityCollectionType.selection]: createCollection([]),
//         [EntityCollectionType.marquee]: createCollection([]),
//         [EntityCollectionType.reverseMarquee]: createCollection([]),
//         [EntityCollectionType.preview]: createCollection(["preview-entity"]),
//         [EntityCollectionType.ghost]: createCollection([]),
//         [EntityCollectionType.logisticsHead]: createCollection([]),
//         [EntityCollectionType.powered]: createCollection([]),
//         [EntityCollectionType.invalidPlacement]: createCollection([]),
//       },
//     },
//     queries: {
//       findEntityCollectionGridRect: vi.fn((collectionType) =>
//         collectionType === EntityCollectionType.preview
//           ? previewRectRef.current
//           : null,
//       ),
//     },
//     actions: {
//       zoom,
//       moveCollectionTo,
//     },
//   } as unknown as EditorContract;
//
//   return {
//     context: {
//       workspace: {
//         editor,
//       } as unknown as WorkspaceContract,
//       appHost: {
//         state: {
//           settings: {
//             // AI-REMOVED 2026-09-10:
//             // Reason: 操作模式总开关已废弃，不再保留关闭分支
//             // Trigger: 用户要求彻底移除 hypergryphOperationMode。
//             // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
//             // Replacement: 测试状态不再需要模式字段
//             // Risk: 历史 false 设置统一使用当前操作行为。
//             // Human Review: Required
//             //
//             // Original code:
//             // hypergryphOperationMode: true,
//           },
//           screenProfile: {
//             deviceClass: "mobile",
//           },
//         },
//         internalState: {
//           activeTool: "single-placement",
//           runtime: {
//             placementAnchor: { x: 20, y: 0 },
//           },
//         },
//         internalActions: {
//           alignCanvasFloatingToolbar: vi.fn(() => true),
//         },
//       } as unknown as AppHost,
//       keyboard: emptyKeyboardSnapshot(),
//     },
//     moveCollectionTo,
//     previewRectRef,
//     zoom,
//   };
// }
function createMobilePlacementContext() {
  // 2026-11-12：真实相机执行后仍以中心 0、10×10 世界格验证原回推断言。
  const test = createCanvasTestSession({ activeTool: "single-placement",
    viewport: { center: { x: 0, y: 0 }, gridSize: 2 ** (-2 / 3), displayRotation: 0 } }); cleanups.push(test.dispose);
  test.app.internalActions.setScreenProfile({ ...test.app.state.screenProfile, deviceClass: "mobile" });
  test.view.actions.setViewportClientRect({ left: 0, top: 0, width: 160, height: 160 });
  test.canvas.state.runtime.placementAnchor = { x: 20, y: 0 };
  test.editor.actions.createSinglePlacementDraft({ definitionId: "power_sta_1", centerGridPoint: { x: 20, y: 0 } });
  return { context: test.context, moveCollectionTo: vi.spyOn(test.editor.actions, "moveCollectionTo"),
    zoom: vi.spyOn(test.view.actions, "zoom"), previewRectRef: { get current() { return test.editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview); } } };
}

// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
// Human Review: Required
// Original code:
// type MockCollection = string[] & {
//   contains(entityId: string): boolean;
//   replace(entityIds: readonly string[]): void;
// };


// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
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


// AI-REMOVED 2026-11-12:
// Reason: 相机与工具状态已从业务主机迁出。
// Trigger: REQ-048 View/Canvas 契约。
// Evidence: 手势模块使用 context.canvas.view。
// Replacement: createCanvasTestSession；真实相机动作和草稿。
// Risk: 原断言不变；布景保持操作后的同一世界可视区域。
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


function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}
