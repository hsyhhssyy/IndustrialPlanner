import {
  SWITCH_DEVICE_MODE_BUTTON_ID,
  resolveNextSwitchableEntityVariantDefinitionId,
} from "@/app/entity-variant-availability";
import type { AppHost } from "@/app/host/app-host";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphEntityVariantSwitchGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-entity-variant-switch-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null || !canSwitchSelectionFromTool(context.appHost.internalState.activeTool)) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "ui-button-touch-tap":
          return event.uiButtonId === SWITCH_DEVICE_MODE_BUTTON_ID
            ? switchSelectedEntityVariant(context.appHost, editor)
            : { status: "ignored" };

        case "ui-button-mouse-tap":
          if (event.button !== 0 || event.uiButtonId !== SWITCH_DEVICE_MODE_BUTTON_ID) {
            return { status: "ignored" };
          }

          return switchSelectedEntityVariant(context.appHost, editor);

        default:
          return { status: "ignored" };
      }
    },
  };
}

function canSwitchSelectionFromTool(activeTool: AppHost["internalState"]["activeTool"]): boolean {
  return activeTool === "select" || activeTool === "marquee";
}

function switchSelectedEntityVariant(
  appHost: AppHost,
  editor: EditorContract,
): GestureHandleResult {
  const selection = editor.state.collections[EntityCollectionType.selection];
  if (selection.length !== 1) {
    return { status: "ignored" };
  }

  const entityId = selection[0];
  if (entityId === undefined) {
    return { status: "ignored" };
  }

  const entity = editor.queries.getEntityById(entityId);
  if (entity === null) {
    return { status: "ignored" };
  }

  const nextDefinitionId = resolveNextSwitchableEntityVariantDefinitionId({
    appHost,
    definitionId: entity.definitionId,
  });
  if (nextDefinitionId === null) {
    return { status: "ignored" };
  }

  return editor.actions.replaceEntityDefinition(entity.id, nextDefinitionId)
    ? { status: "handled" }
    : { status: "ignored" };
}
