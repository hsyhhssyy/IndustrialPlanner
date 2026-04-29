import type { AppHost } from "@/app/host/app-host";
import { EntityCollectionType } from "@/domain/state/types";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphSelectGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-select-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null || context.appHost.internalState.activeTool !== "select") {
        return { status: "ignored" };
      }

      const selectEntity = (entityId: string) => {
        if (!editor.state.collections.selection.contains(entityId)) {
          editor.actions.clearCollection(EntityCollectionType.selection);
        }

        editor.actions.addToCollection({
          collectionType: EntityCollectionType.selection,
          entityId,
        });
      };

      switch (event.type) {
        case "mouse tap":
          if (event.button === 2) {
            editor.actions.clearCollection(EntityCollectionType.selection);
            return { status: "handled" };
          }

          if (event.button !== 0 || event.pointerEntity === null) {
            return { status: "ignored" };
          }

          selectEntity(event.pointerEntity.id);
          return { status: "handled" };

        case "touch tap":
          if (event.pointerEntity === null) {
            return { status: "ignored" };
          }

          selectEntity(event.pointerEntity.id);
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}