import type { EditorAction } from "@/domain/editor/editor-action";

import type { EditorActionsContext } from "./types";

type EditorConfigActions = Pick<EditorAction, "patchEntityConfig">;

export function createEditorConfigActions({
  document,
  documentWriter,
}: EditorActionsContext): EditorConfigActions {
  return {
    patchEntityConfig: (entityId, patch) => {
      if (Object.keys(patch).length === 0) {
        return;
      }

      const currentDocument = document.getSnapshot();
      const entity = currentDocument.entities[entityId];

      if (entity === undefined) {
        return;
      }

      let didChange = false;
      const nextConfig = {
        ...entity.config,
      };

      for (const [path, value] of Object.entries(patch)) {
        if (Object.is(nextConfig[path], value)) {
          continue;
        }

        nextConfig[path] = value;
        didChange = true;
      }

      if (!didChange) {
        return;
      }

      documentWriter.commit({
        action: {
          type: "entity.config.patch",
          label: "修改设备配置",
          detail: Object.keys(patch).join(", "),
          entityIds: [entityId],
          definitionIds: [entity.definitionId],
          count: Object.keys(patch).length,
        },
        update: (documentSnapshot) => ({
          ...documentSnapshot,
          entities: {
            ...documentSnapshot.entities,
            [entityId]: {
              ...entity,
              config: nextConfig,
            },
          },
        }),
      });
    },
  };
}
