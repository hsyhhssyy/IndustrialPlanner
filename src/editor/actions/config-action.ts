import type { EditorAction } from "@/domain/editor/editor-action";

import type { EditorActionsContext } from "./types";

type EditorConfigActions = Pick<EditorAction, "patchEntityConfig">;

export function createEditorConfigActions({
  document,
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

      document.setSnapshot({
        ...currentDocument,
        entities: {
          ...currentDocument.entities,
          [entityId]: {
            ...entity,
            config: nextConfig,
          },
        },
      });
    },
  };
}