import { CanvasTextMetrics, TextStyle } from "pixi.js";
import { createRegionLabelStyle, resolveRegionLabelLayout, resolveRegionLabelText } from "@/shared/geometry/region-label-layout";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridPoint, GridRect } from "@/domain/shared/grid";

import type { GestureHandleResult, GestureMappingModule } from "../types";
// AI-REMOVED 2026-09-10:
// Reason: 操作模式总开关已废弃，不再保留关闭分支
// Trigger: 用户要求彻底移除 hypergryphOperationMode。
// Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
// Replacement: gesture-action-router.ts 的默认启用语义
// Risk: 历史 false 设置统一使用当前操作行为。
// Human Review: Required
//
// Original code:
// import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphRegionGestureModule(): GestureMappingModule<AppHost> {
  let anchor: GridPoint | null = null;

  return {
    id: "hypergryph-region-gesture",
    priority: 110,
    cancel: () => { anchor = null; },
    // AI-REMOVED 2026-09-10:
    // Reason: 操作模式总开关已废弃，不再保留关闭分支
    // Trigger: 用户要求彻底移除 hypergryphOperationMode。
    // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
    // Replacement: gesture-action-router.ts 的默认启用语义
    // Risk: 历史 false 设置统一使用当前操作行为。
    // Human Review: Required
    //
    // Original code:
    // when: isHypergryphGestureEnabled,
    acceptsLongPress(context) {
      return context.canvas.workbench.state.settings.showRegionAnnotations
        && context.canvas.state.activeTool === "region-edit";
    },
    handle(event, context) {
      const editor = context.canvas.editor;
      if (editor !== null && context.canvas.state.activeTool === "select"
        && context.canvas.isOperationEnabled("region-edit")
        && context.canvas.workbench.state.settings.showRegionAnnotations
        && (event.type === "touch tap" || (event.type === "mouse tap" && event.button === 0))) {
        const state = editor.state.regionAnnotations;
        const viewport = context.canvas.view.state;
        const regions = editor.document.getSnapshot().regions;
        for (let index = regions.length - 1; index >= 0; index--) {
          const region = regions[index]!;
          if (region.id === state.draft?.id || state.hiddenIds.includes(region.id)) continue;
          const text = resolveRegionLabelText(region, region.id === state.selectedId || region.id === state.hoveredId,
            context.canvas.workbench.state.settings.locale === "en-US" ? "cells" : "格");
          const metrics = CanvasTextMetrics.measureText(text, new TextStyle(createRegionLabelStyle(Number.parseInt(region.color.slice(1), 16))));
          const bounds = resolveRegionLabelLayout({
            rects: region.rects, viewportBounds: viewport.clientRect, viewportCenter: viewport.center,
            gridCellPixelSize: viewport.gridCellPixelSize, displayRotation: viewport.displayRotation,
            labelWidth: metrics.width, labelHeight: metrics.height,
          });
          if (bounds !== null && event.position.x >= bounds.left && event.position.x <= bounds.left + bounds.width
            && event.position.y >= bounds.top && event.position.y <= bounds.top + bounds.height) {
            editor.actions.selectRegion(region.id);
            return { status: "handled" };
          }
        }
      }

      if (event.type === "on-exit-active-tool") {
        if (event.from !== "region-edit" || event.to === "region-edit") {
          return { status: "ignored" };
        }
        anchor = null;
        editor?.actions.cancelRegionDraft();
        return { status: "handled" };
      }

      if (
        editor === null
        || !context.canvas.workbench.state.settings.showRegionAnnotations
        || context.canvas.state.activeTool !== "region-edit"
        || editor.state.regionAnnotations.draft === null
      ) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse dragstart":
          if (event.originButton !== 0) {
            return { status: "ignored" };
          }
          return startRegionDrag(editor, context.canvas.view, event.position, (nextAnchor) => {
            anchor = nextAnchor;
          });

        case "touch dragstart":
          if (!event.longPress) {
            return { status: "ignored" };
          }
          return startRegionDrag(editor, context.canvas.view, event.position, (nextAnchor) => {
            anchor = nextAnchor;
          });

        case "mouse dragmove":
        case "touch dragmove":
          return updateRegionDrag(editor, context.canvas.view, anchor, event.position);

        case "mouse dragend":
        case "touch dragend": {
          if (anchor === null) {
            return { status: "ignored" };
          }
          if (event.reason === "cancel") {
            editor.actions.setRegionDraftMarquee(null);
          } else {
            updateRegionDrag(editor, context.canvas.view, anchor, event.position);
            editor.actions.applyRegionDraftMarquee();
          }
          anchor = null;
          editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          return { status: "handled" };
        }

        case "mouse move":
          editor.actions.setHoverPoint(event.position, context.canvas.view.state);
          return { status: "handled", consume: false };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function startRegionDrag(
  editor: EditorContract, view: EditorViewContract,
  position: GesturePosition,
  setAnchor: (anchor: GridPoint) => void,
): GestureHandleResult {
  const anchor = view.queries.findGridCellForClientPixelPoint(position);
  if (anchor === null) {
    return { status: "ignored" };
  }

  setAnchor(anchor);
  editor.actions.clearHoverPoint();
  editor.actions.setRegionDraftMarquee(resolveGridRectFromPoints(anchor, anchor));
  return { status: "handled" };
}

function updateRegionDrag(
  editor: EditorContract, view: EditorViewContract,
  anchor: GridPoint | null,
  position: GesturePosition,
): GestureHandleResult {
  const currentPoint = view.queries.findGridCellForClientPixelPoint(position);
  if (anchor === null || currentPoint === null) {
    return { status: "ignored" };
  }

  editor.actions.setRegionDraftMarquee(resolveGridRectFromPoints(anchor, currentPoint));
  return { status: "handled" };
}

function resolveGridRectFromPoints(start: GridPoint, end: GridPoint): GridRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    x: left,
    y: top,
    width: Math.max(start.x, end.x) - left + 1,
    height: Math.max(start.y, end.y) - top + 1,
  };
}
