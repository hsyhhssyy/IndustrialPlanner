import { action } from "mobx";
import { resolveGridCellAtClientPixelPoint } from "../queries";
import type { EditorAction } from "@/domain/editor/editor-action";

import type { EditorActionsContext } from "./types";

type EditorHoverActions = Pick<EditorAction, "setHoverPoint" | "clearHoverPoint">;

export function createEditorHoverActions(
  context: EditorActionsContext,
): EditorHoverActions {
  return {
    // 2026-11-12：SceneSource 会观察悬停；公开写入口自行建立 action，不依赖手势或窗口调用方。
    setHoverPoint: action((clientPixel, viewport) => {
      // AI-REMOVED 2026-11-12:
      // Reason: 当前会话查询不能经全局 workspace.editor 转调。
      // Trigger: REQ-048 多会话隔离。
      // Evidence: 该引用始终命中主 Editor。
      // Replacement: context.queries。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // const editor = context.workspace.editor;
      // if (editor === null) return;

      // pixel → grid 转换
      const gridPoint = resolveGridCellAtClientPixelPoint({ clientPixelPoint: clientPixel, viewportState: viewport });
      if (gridPoint === null) {
        context.state.hoverTarget = null;
        return;
      }

      // 命中检测
      const entity = context.queries.findEntityAtClientPixelPoint(clientPixel, viewport);
      // 设备 hover 时，四角特效应固定在设备 footprint 上，而非跟随鼠标移动
      const hoverTarget = entity !== null
        ? { entity: { id: entity.id, definitionId: entity.definitionId, rotation: entity.rotation }, gridPoint: entity.position }
        : { entity: null, gridPoint };

      context.state.hoverTarget = hoverTarget;
    }),

    clearHoverPoint: action(() => {
      context.state.hoverTarget = null;
    }),
  };
}
