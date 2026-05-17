import type { EditorAction } from "@/domain/editor/editor-action";

import type { EditorActionsContext } from "./types";

type EditorConfigActions = Pick<EditorAction, "patchEntityConfig" | "deleteEntityConfigKeys">;

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

    deleteEntityConfigKeys: (entityId, keys) => {
      if (keys.length === 0) {
        return;
      }

      const currentDocument = document.getSnapshot();
      const entity = currentDocument.entities[entityId];

      if (entity === undefined) {
        return;
      }

      // 收集所有需要删除的键：显式指定的键 + 以这些键为前缀的子键
      const keysToDelete = new Set<string>();
      const configKeys = Object.keys(entity.config);

      for (const deleteKey of keys) {
        for (const configKey of configKeys) {
          if (configKey === deleteKey) {
            keysToDelete.add(configKey);
          } else if (configKey.startsWith(deleteKey + ".") || configKey.startsWith(deleteKey + "[")) {
            // 子键：links[0].id、links[0].source.entityId 等
            keysToDelete.add(configKey);
          }
        }
      }

      if (keysToDelete.size === 0) {
        return;
      }

      const nextConfig: Record<string, unknown> = {};
      for (const [configKey, value] of Object.entries(entity.config)) {
        if (keysToDelete.has(configKey)) {
          continue;
        }
        nextConfig[configKey] = value;
      }

      documentWriter.commit({
        action: {
          type: "entity.config.delete-keys",
          label: "删除设备配置键",
          detail: keys.join(", "),
          entityIds: [entityId],
          definitionIds: [entity.definitionId],
          count: keysToDelete.size,
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
