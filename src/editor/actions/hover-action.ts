import type { EditorAction } from "@/domain/editor/editor-action";

import type { EditorActionsContext } from "./types";

type EditorHoverActions = Pick<EditorAction, "setHoverPoint" | "clearHoverPoint">;

export function createEditorHoverActions(
  context: EditorActionsContext,
): EditorHoverActions {
  return {
    setHoverPoint(clientPixel) {
      const editor = context.workspace.editor;
      if (editor === null) return;

      // pixel → grid 转换
      const gridPoint = editor.queries.findGridCellForClientPixelPoint(clientPixel);
      if (gridPoint === null) {
        context.state.hoverTarget = null;
        return;
      }

      // 命中检测
      const entity = editor.queries.findEntityAtClientPixelPoint(clientPixel);
      // 设备 hover 时，四角特效应固定在设备 footprint 上，而非跟随鼠标移动
      const hoverTarget = entity !== null
        ? { entity: { id: entity.id, definitionId: entity.definitionId, rotation: entity.rotation }, gridPoint: entity.position }
        : { entity: null, gridPoint };

      context.state.hoverTarget = hoverTarget;
    },

    clearHoverPoint() {
      context.state.hoverTarget = null;
    },
  };
}
