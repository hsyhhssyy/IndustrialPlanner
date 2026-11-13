import { createCanvasTestSession } from "@/tests/helpers/canvas-test-session";
import { afterEach, describe, expect, it, vi } from "vitest";

// AI-REMOVED 2026-11-12:
// Reason: 旧输入测试伪造 Editor/App 及已退出的 viewport，不能覆盖真实会话。
// Trigger: REQ-048 相机和 Canvas 契约迁移。
// Evidence: 当前业务通过独立 view 投影，Editor 查询必须来自真实文档。
// Replacement: 真实 Canvas fixture 推导类型
// Risk: 真正布局与原生触控另由浏览器验证。
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";
import {
  MOBILE_PREVIEW_SAFE_INSET_CELLS,
  TOUCH_PREVIEW_HIT_SLOP_PX,
  isPreviewBoundingBoxAtClientPoint,
  nudgeMobilePreviewIntoSafeViewport,
} from "@/app/input/gesture/actions/hypergryph/mobile-preview-bounds";
// AI-REMOVED 2026-11-12:
// Reason: 旧输入测试伪造 Editor/App 及已退出的 viewport，不能覆盖真实会话。
// Trigger: REQ-048 相机和 Canvas 契约迁移。
// Evidence: 当前业务通过独立 view 投影，Editor 查询必须来自真实文档。
// Replacement: 真实 Canvas fixture 推导类型
// Risk: 真正布局与原生触控另由浏览器验证。
// Human Review: Required
// Original code:
// import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });

describe("mobile preview bounds", () => {
  it("keeps the preview inside the mobile safe area with at least one visible grid cell", () => {
    expect(MOBILE_PREVIEW_SAFE_INSET_CELLS).toEqual({ x: 1, y: 1 });

    const { canvas, editor, previewRectRef } = createContext({
      previewRect: { x: 20, y: 0, width: 2, height: 2 },
      placementAnchor: { x: 20, y: 0 },
    });

    expect(nudgeMobilePreviewIntoSafeViewport({ canvas, editor })).toBe(true);

    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: 20, y: 0 },
      endGridPoint: { x: 3, y: 0 },
    });
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(canvas.state.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });

  it("does not move when one grid cell is already visible inside the safe area", () => {
    const { canvas, editor, previewRectRef } = createContext({
      previewRect: { x: 3, y: 0, width: 2, height: 2 },
      placementAnchor: { x: 3, y: 0 },
    });

    expect(nudgeMobilePreviewIntoSafeViewport({ canvas, editor })).toBe(false);

    expect(editor.actions.moveCollectionTo).not.toHaveBeenCalled();
    expect(previewRectRef.current).toEqual({ x: 3, y: 0, width: 2, height: 2 });
    expect(canvas.state.runtime.placementAnchor).toEqual({ x: 3, y: 0 });
  });

  it("keeps move anchors in sync when nudging a move preview", () => {
    const { canvas, editor } = createContext({
      activeTool: "move",
      moveAnchor: { x: -20, y: 0 },
      previewRect: { x: -20, y: 0, width: 2, height: 2 },
    });

    expect(nudgeMobilePreviewIntoSafeViewport({ canvas, editor })).toBe(true);

    expect(editor.actions.moveCollectionTo).toHaveBeenCalledWith({
      collectionType: EntityCollectionType.preview,
      startGridPoint: { x: -20, y: 0 },
      endGridPoint: { x: -5, y: 0 },
    });
    expect(canvas.state.runtime.moveAnchor).toEqual({ x: -5, y: 0 });
  });

  it("uses CSS-pixel touch hit slop around the preview bounding box", () => {
    const { editor, view } = createContext({
      previewRect: { x: 0, y: 0, width: 2, height: 2 },
    });

    expect(TOUCH_PREVIEW_HIT_SLOP_PX).toBe(16);
    expect(isPreviewBoundingBoxAtClientPoint({
      editor,
      view,
      position: { x: 23, y: 6 },
      hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
    })).toBe(true);
    expect(isPreviewBoundingBoxAtClientPoint({
      editor,
      view,
      position: { x: 23.01, y: 6 },
      hitSlopPx: TOUCH_PREVIEW_HIT_SLOP_PX,
    })).toBe(false);
  });
});

// AI-REMOVED 2026-11-12:
// Reason: 旧输入测试伪造 Editor/App 及已退出的 viewport，不能覆盖真实会话。
// Trigger: REQ-048 相机和 Canvas 契约迁移。
// Evidence: 当前业务通过独立 view 投影，Editor 查询必须来自真实文档。
// Replacement: createCanvasTestSession
// Risk: 真正布局与原生触控另由浏览器验证。
// Human Review: Required
// Original code:
// function createContext(options: {
//   activeTool?: "single-placement" | "blueprint-placement" | "move";
//   placementAnchor?: GridPoint | null;
//   moveAnchor?: GridPoint | null;
//   previewRect: GridRect;
// }): {
//   appHost: AppHost;
//   editor: EditorContract;
//   previewRectRef: { current: GridRect };
// } {
//   const previewRectRef = {
//     current: options.previewRect,
//   };
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
//       findGridCellForClientPixelPoint: vi.fn(() => ({ x: 100, y: 100 })),
//       findEntityCollectionGridRect: vi.fn((collectionType) =>
//         collectionType === EntityCollectionType.preview
//           ? previewRectRef.current
//           : null,
//       ),
//     },
//     actions: {
//       moveCollectionTo: vi.fn(({ startGridPoint, endGridPoint }) => {
//         previewRectRef.current = {
//           ...previewRectRef.current,
//           x: previewRectRef.current.x + endGridPoint.x - startGridPoint.x,
//           y: previewRectRef.current.y + endGridPoint.y - startGridPoint.y,
//         };
//       }),
//     },
//   } as unknown as EditorContract;
//
//   const appHost = {
//     state: {
//       screenProfile: {
//         deviceClass: "mobile",
//       },
//     },
//     internalState: {
//       activeTool: options.activeTool ?? "single-placement",
//       runtime: {
//         placementAnchor: options.placementAnchor ?? null,
//         moveAnchor: options.moveAnchor ?? null,
//       },
//     },
//   } as unknown as AppHost;
//
//   return {
//     appHost,
//     editor,
//     previewRectRef,
//   };
// }
//
// type MockCollection = string[] & {
//   contains(entityId: string): boolean;
//   replace(entityIds: readonly string[]): void;
// };
//
// function createCollection(entityIds: readonly string[]): MockCollection {
//   const collection = [...entityIds] as MockCollection;
//   collection.contains = (entityId: string) => collection.includes(entityId);
//   collection.replace = (nextEntityIds: readonly string[]) => {
//     collection.splice(0, collection.length, ...nextEntityIds);
//   };
//   return collection;
// }
function createContext(options: {
  activeTool?: "single-placement" | "blueprint-placement" | "move";
  placementAnchor?: GridPoint | null;
  moveAnchor?: GridPoint | null;
  previewRect: GridRect;
}) {
  const test = createCanvasTestSession({ activeTool: options.activeTool ?? "single-placement",
    viewport: { center: { x: 0, y: 0 }, gridSize: 1 / 16, displayRotation: 0 } });
  cleanups.push(test.dispose);
  const { app, canvas, editor, view } = test;
  app.internalActions.setScreenProfile({ ...app.state.screenProfile, deviceClass: "mobile" });
  view.actions.setViewportClientRect({ left: 0, top: 0, width: 10, height: 10 });
  canvas.state.runtime.placementAnchor = options.placementAnchor ?? null;
  canvas.state.runtime.moveAnchor = options.moveAnchor ?? null;
  editor.actions.createSinglePlacementDraft({ definitionId: "power_sta_1",
    centerGridPoint: { x: options.previewRect.x, y: options.previewRect.y } });
  expect(editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview)).toEqual(options.previewRect);
  vi.spyOn(editor.actions, "moveCollectionTo");
  return { canvas, editor, view, previewRectRef: { get current() { return editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview); } } };
}
