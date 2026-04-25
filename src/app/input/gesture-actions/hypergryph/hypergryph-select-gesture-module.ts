import type { AppHost } from "@/app/app-host";
import { EntityCollectionType } from "@/domain/state/types";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphSelectGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-select-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;
      if (editor === null || context.appHost.internalState.runtime.activeTool !== "select") {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse tap":
          if (event.button === 2) {
            editor.actions.clearCollection(EntityCollectionType.selection);
            return { status: "handled" };
          }

          if (event.button !== 0 || event.pointerEntity === null) {
            return { status: "ignored" };
          }

          editor.actions.addToCollection({
            collectionType: EntityCollectionType.selection,
            entityId: event.pointerEntity.id,
          });
          return { status: "handled" };

        case "touch tap":
          if (event.pointerEntity === null) {
            return { status: "ignored" };
          }

          editor.actions.addToCollection({
            collectionType: EntityCollectionType.selection,
            entityId: event.pointerEntity.id,
          });
          return { status: "handled" };

        default:
          return { status: "ignored" };
      }
    },
  };
}