import type { EditorAction } from "@/domain/editor/editor-action";

import { createEditorConfigActions } from "./config-action";
import { createEditorDefinitionActions } from "./definition-action";
import { createEditorDocumentActions } from "./document-action";
import { createEditorHistoryActions } from "./history-action";
import { createEditorLogisticsActions } from "./logistics-action";
import { createEditorMoveActions } from "./move-action";
import { createEditorPlacementActions } from "./placement-action";
import { createEditorSelectionActions } from "./selection-actions";
import { createEditorTransportActions } from "./transport-action";
import type { EditorActionsContext } from "./types";
import { createEditorViewportActions } from "./viewport-actions";

export function createEditorActions(
  context: EditorActionsContext,
): EditorAction {
  return {
    ...createEditorConfigActions(context),
    ...createEditorDefinitionActions(context),
    ...createEditorDocumentActions(context),
    ...createEditorHistoryActions(context),
    ...createEditorLogisticsActions(context),
    ...createEditorMoveActions(context),
    ...createEditorPlacementActions(context),
    ...createEditorViewportActions(context),
    ...createEditorSelectionActions(context),
    ...createEditorTransportActions(context),
  };
}

export type { EditorActionsContext } from "./types";
