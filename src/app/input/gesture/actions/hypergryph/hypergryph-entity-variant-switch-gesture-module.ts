import { SHORTCUT_KEY } from "@/app/actions";
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
    shortcutRoutes: [{
      id: "switch-device-mode.selection",
      actionId: SHORTCUT_KEY.SWITCH_DEVICE_MODE,
      binding: { kind: "configurable", shortcutId: SHORTCUT_KEY.SWITCH_DEVICE_MODE },
      scope: { inputLayers: ["canvas"], activeTools: ["select"] },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        const editor = context.workspace.editor;
        if (editor === null || !context.appHost.state.settings.gameUseInspectorPanel) {
          return { status: "ignored" };
        }

        return switchSelectedEntityVariant(context.appHost, editor);
      },
    }],
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null || !canSwitchSelectionFromTool(context.appHost.internalState.activeTool)) {
        return { status: "ignored" };
      }

      switch (event.type) {
        // AI-REMOVED 2026-08-30:
        // Reason: select 模式的设备变体快捷键已迁入可执行 Route。
        // Trigger: ST2-RQ-020 要求同一 Action 的多模式 Route 分别声明触发策略。
        // Evidence: switch-device-mode.selection 使用 exact 策略并保留 Inspector 设置瞬时条件。
        // Replacement: shortcutRoutes[switch-device-mode.selection] in this module
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        // case "key down":
        //   if (
        //     context.appHost.internalState.activeTool !== "select"
        //     || !context.appHost.state.settings.gameUseInspectorPanel
        //     || !context.appHost.internalActions.isShortcutFor(
        //       SHORTCUT_KEY.SWITCH_DEVICE_MODE,
        //       event.code,
        //       event.key,
        //       event.modifiers,
        //     )
        //   ) {
        //     return { status: "ignored" };
        //   }
        //   return switchSelectedEntityVariant(context.appHost, editor);

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
