import type { EditorAction } from "@/domain/action/editor-action";

import { createEditorConfigActions } from "./config-action";
import { createEditorLogisticsActions } from "./logistics-action";
import { createEditorMoveActions } from "./move-action";
import { createEditorPlacementActions } from "./placement-action";
import { createEditorSelectionActions } from "./selection-actions";
import type { EditorActionsContext } from "./types";
import { createEditorViewportActions } from "./viewport-actions";

export function createEditorActions(
  context: EditorActionsContext,
): EditorAction {
  return {
    ...createEditorConfigActions(context),
    ...createEditorLogisticsActions(context),
    ...createEditorMoveActions(context),
    ...createEditorPlacementActions(context),
    ...createEditorViewportActions(context),
    ...createEditorSelectionActions(context),
  };
}

export type { EditorActionsContext } from "./types";
