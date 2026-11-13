// AI-REMOVED 2026-11-12:
// Reason: 相机状态和持久化资格分离，只有显式绑定的主 View 可以写回。
// Trigger: REQ-048 D4，多视图与无头会话。
// Evidence: 旧入口直接读写 EditorState.viewport 并隐式注册页面监听。
// Replacement: 下方独立 View 绑定及纯设置投影。
// Risk: 基地切换、远端应用、页面退出需要回归。
// Human Review: Required
// Original code:
// import type {
//   WorldDocument,
//   WorldDocumentViewportSettings,
// } from "@/domain/document/world-document";
// import type { EditorServices } from "./editor-services";
// import type { GridRotation } from "@/domain/shared/grid";
// import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";
// import { runInAction } from "mobx";
//
// import type {
//   EditorDocumentWriter,
// } from "./history";
// import type {
//   EditorStateReadWrite,
//   EditorViewportStateReadWrite,
// } from "./state-impl";
// import {
//   clampViewportCenterToBaseWarningBounds,
//   DEFAULT_VIEWPORT_GRID_SIZE,
//   clampViewportGridSize,
//   resolveViewportGridCellPixelSize,
//   resolveContentBoundedViewport,
//   type ViewportBounds,
// } from "./viewport-settings";
//
// export function createDefaultWorldDocumentViewportSettings(): WorldDocumentViewportSettings {
//   return {
//     center: {
//       x: 0,
//       y: 0,
//     },
//     gridSize: DEFAULT_VIEWPORT_GRID_SIZE,
//     displayRotation: 0,
//   };
// }
//
// export function applyWorldDocumentViewportSettings(options: {
//   document: WorldDocument;
//   state: EditorStateReadWrite;
//   workspace: EditorServices;
//   viewportBounds?: ViewportBounds;
// }): void {
//   let viewportSettings = normalizeWorldDocumentViewportSettings(
//     options.document.documentSettings.viewport,
//   );
//
//   if (viewportSettings === null) {
//     return;
//   }
//
//   if (typeof options.viewportBounds === "object" && options.state.internalTransientState.hasMeasuredViewportClientRect) {
//     viewportSettings = { ...viewportSettings, ...resolveContentBoundedViewport({
//       ...viewportSettings, clientRect: options.state.viewport.clientRect, bounds: options.viewportBounds,
//     }) };
//   }
//
//   const baseDefinition = options.workspace.registry.baseDefinitions.find(
//     (definition) => definition.id === options.document.baseId,
//   ) ?? null;
//   const nextViewportCenter = options.viewportBounds === "unbounded" || typeof options.viewportBounds === "object" ? viewportSettings.center : clampViewportCenterToBaseWarningBounds({
//     center: viewportSettings.center,
//     baseDefinition,
//   });
//
//   runInAction(() => {
//     options.state.viewport.center.x = nextViewportCenter.x;
//     options.state.viewport.center.y = nextViewportCenter.y;
//     options.state.viewport.gridSize = viewportSettings.gridSize;
//     options.state.viewport.gridCellPixelSize = resolveViewportGridCellPixelSize(
//       viewportSettings.gridSize,
//     );
//     options.state.viewport.displayRotation = viewportSettings.displayRotation;
//   });
// }
//
// export function persistWorldDocumentViewportSettings(options: {
//   document: SnapshotStoreReadWrite<WorldDocument>;
//   documentWriter: EditorDocumentWriter;
//   state: EditorStateReadWrite;
// }): void {
//   const currentDocument = options.document.getSnapshot();
//   const nextDocument = withWorldDocumentViewportSettings(
//     currentDocument,
//     options.state.viewport,
//   );
//
//   if (nextDocument === currentDocument) {
//     return;
//   }
//
//   options.documentWriter.setSnapshot(nextDocument, {
//     mode: "silent",
//   });
// }
//
// export function createViewportPersistence(
//   options: Parameters<typeof persistWorldDocumentViewportSettings>[0],
// ): { schedule(): void; flush(): void; dispose(): void } {
//   let timer: ReturnType<typeof setTimeout> | null = null;
//   let disposed = false;
//   const flush = (): void => {
//     if (timer === null) return;
//     clearTimeout(timer);
//     timer = null;
//     // 发布时读取最新文档和实时视口，避免覆盖等待期间的设备编辑。
//     persistWorldDocumentViewportSettings(options);
//   };
//   const onVisibilityChange = (): void => {
//     if (globalThis.document?.visibilityState === "hidden") flush();
//   };
//   globalThis.addEventListener?.("pagehide", flush);
//   globalThis.document?.addEventListener("visibilitychange", onVisibilityChange);
//   return {
//     schedule: () => {
//       if (disposed || timer !== null) return;
//       timer = setTimeout(flush, 1000);
//     },
//     flush,
//     dispose: () => {
//       flush();
//       disposed = true;
//       globalThis.removeEventListener?.("pagehide", flush);
//       globalThis.document?.removeEventListener("visibilitychange", onVisibilityChange);
//     },
//   };
// }
//
// function withWorldDocumentViewportSettings(
//   document: WorldDocument,
//   viewport: EditorViewportStateReadWrite,
// ): WorldDocument {
//   const nextViewportSettings = createWorldDocumentViewportSettings(viewport);
//   const currentViewportSettings = normalizeWorldDocumentViewportSettings(
//     document.documentSettings.viewport,
//   );
//
//   if (
//     currentViewportSettings !== null
//     && areWorldDocumentViewportSettingsEqual(
//       currentViewportSettings,
//       nextViewportSettings,
//     )
//   ) {
//     return document;
//   }
//
//   return {
//     ...document,
//     documentSettings: {
//       ...document.documentSettings,
//       viewport: nextViewportSettings,
//     },
//   };
// }
//
// function createWorldDocumentViewportSettings(
//   viewport: EditorViewportStateReadWrite,
// ): WorldDocumentViewportSettings {
//   return {
//     center: {
//       x: viewport.center.x,
//       y: viewport.center.y,
//     },
//     gridSize: clampViewportGridSize(viewport.gridSize),
//     displayRotation: viewport.displayRotation,
//   };
// }
//
// function normalizeWorldDocumentViewportSettings(
//   value: unknown,
// ): WorldDocumentViewportSettings | null {
//   if (!isRecord(value) || !isRecord(value.center)) {
//     return null;
//   }
//
//   const centerX = value.center.x;
//   const centerY = value.center.y;
//   const gridSize = value.gridSize;
//   const displayRotation = normalizeGridRotation(value.displayRotation);
//
//   if (
//     typeof centerX !== "number"
//     || typeof centerY !== "number"
//     || !Number.isFinite(centerX)
//     || !Number.isFinite(centerY)
//   ) {
//     return null;
//   }
//
//   return {
//     center: {
//       x: centerX,
//       y: centerY,
//     },
//     gridSize: typeof gridSize === "number"
//       ? clampViewportGridSize(gridSize)
//       : DEFAULT_VIEWPORT_GRID_SIZE,
//     displayRotation,
//   };
// }
//
// function areWorldDocumentViewportSettingsEqual(
//   left: WorldDocumentViewportSettings,
//   right: WorldDocumentViewportSettings,
// ): boolean {
//   return (
//     left.center.x === right.center.x
//     && left.center.y === right.center.y
//     && left.gridSize === right.gridSize
//     && left.displayRotation === right.displayRotation
//   );
// }
//
// function isRecord(value: unknown): value is Record<string, unknown> {
//   return typeof value === "object" && value !== null;
// }
//
// function normalizeGridRotation(value: unknown): GridRotation {
//   return value === 90 || value === 180 || value === 270 ? value : 0;
// }

import { comparer, reaction } from "mobx";
import type { WorldDocument, WorldDocumentViewportSettings } from "@/domain/document/world-document";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { EditorViewState } from "@/domain/editor/editor-view-state";
import type { SceneSpace } from "@/domain/shared/scene-space";
import type { SceneSnapshotSource } from "@/domain/shared/scene-snapshot";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";
import type { EditorDocumentWriter } from "./history";
import { clampViewportGridSize, DEFAULT_VIEWPORT_GRID_SIZE } from "./viewport-settings";

export function createDefaultWorldDocumentViewportSettings(): WorldDocumentViewportSettings {
  return { center: { x: 0, y: 0 }, gridSize: DEFAULT_VIEWPORT_GRID_SIZE, displayRotation: 0 };
}

export function normalizeWorldDocumentViewportSettings(value: unknown): WorldDocumentViewportSettings | null {
  if (typeof value !== "object" || value === null || !("center" in value)
    || typeof value.center !== "object" || value.center === null
    || !("x" in value.center) || !("y" in value.center)
    || typeof value.center.x !== "number" || typeof value.center.y !== "number"
    || !Number.isFinite(value.center.x) || !Number.isFinite(value.center.y)) return null;
  const rotation = "displayRotation" in value ? value.displayRotation : 0;
  return {
    center: { x: value.center.x, y: value.center.y },
    gridSize: "gridSize" in value && typeof value.gridSize === "number" ? clampViewportGridSize(value.gridSize) : DEFAULT_VIEWPORT_GRID_SIZE,
    displayRotation: rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0,
  };
}

export function applyWorldDocumentViewportSettings(options: {
  document: WorldDocument; view: EditorViewContract; space: SceneSpace;
}): void {
  const saved = normalizeWorldDocumentViewportSettings(options.document.documentSettings.viewport)
    ?? createDefaultWorldDocumentViewportSettings();
  options.view.actions.setBoundsPolicy({ kind: "space", padding: 2,
    bounds: resolveBaseOuterBounds(options.space) ?? { minX: null, minY: null, maxX: null, maxY: null } });
  options.view.actions.setViewportDisplayRotation(saved.displayRotation);
  options.view.actions.focusOnBounds({ x: saved.center.x - 0.5, y: saved.center.y - 0.5, width: 1, height: 1 },
    { durationMs: 0, gridSize: saved.gridSize });
}

export function withWorldDocumentViewportSettings(document: WorldDocument, viewport: EditorViewState): WorldDocument {
  const next = { center: { ...viewport.center }, gridSize: clampViewportGridSize(viewport.gridSize), displayRotation: viewport.displayRotation };
  const current = normalizeWorldDocumentViewportSettings(document.documentSettings.viewport);
  if (current !== null && comparer.structural(current, next)) return document;
  return { ...document, documentSettings: { ...document.documentSettings, viewport: next } };
}

export function persistWorldDocumentViewportSettings(options: {
  document: SceneSnapshotSource<WorldDocument>; documentWriter: EditorDocumentWriter; view: EditorViewContract;
}): void {
  const current = options.document.getSnapshot();
  const next = withWorldDocumentViewportSettings(current, options.view.state);
  if (next !== current) options.documentWriter.setSnapshot(next, { mode: "silent" });
}

/** 由组合根仅为主 View 显式创建；临时视图没有存储资格或页面监听。 */
export function bindEditorViewToDocument(options: {
  document: SceneSnapshotSource<WorldDocument>; documentWriter: EditorDocumentWriter;
  view: EditorViewContract; readSpace(): SceneSpace;
}): { flush(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let restoring = false;
  let documentKey: string | null = null;
  const flush = (): void => {
    if (timer === null || disposed) return;
    clearTimeout(timer);
    timer = null;
    persistWorldDocumentViewportSettings(options);
  };
  const stopDocument = options.document.subscribe((document) => {
    if (documentKey === document.documentKey) return;
    // 组合根把 flush 接到 Editor 的 beforeDocumentChange，旧文档在切换前已保存。
    documentKey = document.documentKey;
    restoring = true;
    try { applyWorldDocumentViewportSettings({ document, view: options.view, space: options.readSpace() }); }
    finally { restoring = false; }
  });
  const stopView = reaction(() => [options.view.state.center.x, options.view.state.center.y,
    options.view.state.gridSize, options.view.state.displayRotation], () => {
    if (!restoring && !disposed && timer === null) timer = setTimeout(flush, 1000);
  }, { equals: comparer.structural });
  const onVisibilityChange = (): void => { if (globalThis.document?.visibilityState === "hidden") flush(); };
  globalThis.addEventListener?.("pagehide", flush);
  globalThis.document?.addEventListener("visibilitychange", onVisibilityChange);
  return { flush, dispose: () => {
    if (disposed) return;
    flush(); disposed = true;
    stopDocument(); stopView();
    globalThis.removeEventListener?.("pagehide", flush);
    globalThis.document?.removeEventListener("visibilitychange", onVisibilityChange);
  } };
}
