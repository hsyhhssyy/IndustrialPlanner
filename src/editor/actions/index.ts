import type { EditorAction } from "@/domain/action/editor-action";

import { createEditorSelectionActions } from "./selection-actions";
import type { EditorActionsContext } from "./types";
import { createEditorViewportActions } from "./viewport-actions";

export function createEditorActions(
  context: EditorActionsContext,
): EditorAction {
  return {
    ...createEditorViewportActions(context),
    ...createEditorSelectionActions(context),
  };
}

export type { EditorActionsContext } from "./types";
