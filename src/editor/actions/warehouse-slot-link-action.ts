import type { EditorAction } from "@/domain/editor/editor-action";
import type { SlotLinkDefinition } from "@/domain/document/world-document";
import { action } from "mobx";

import type { EditorActionsContext } from "./types";

const WAREHOUSE_LINK_ID_PREFIX = "warehouse-link:";

type EditorWarehouseSlotLinkActions = Pick<
  EditorAction,
  "createWarehouseSlotLink" | "removeWarehouseSlotLink"
>;

export function createEditorWarehouseSlotLinkActions({
  document,
  documentWriter,
}: EditorActionsContext): EditorWarehouseSlotLinkActions {
  return {
    createWarehouseSlotLink: action((options) => {
      const currentDocument = document.getSnapshot();
      const entity = currentDocument.entities[options.entityId];
      if (entity === undefined) {
        return false;
      }

      const nextLink: SlotLinkDefinition = {
        id: `${WAREHOUSE_LINK_ID_PREFIX}${options.entityId}:${options.storageSlotGroupId}:${options.slotId}`,
        linkType: "share-all",
        source: {
          entityId: options.entityId,
          storageSlotGroupId: options.storageSlotGroupId,
          slotId: options.slotId,
        },
        target: {
          entityId: "warehouse",
          storageSlotGroupId: "warehouse",
          slotId: options.itemId,
        },
      };

      const committedDocument = documentWriter.commit({
        action: {
          type: "document.unknown",
          label: "创建仓库物品链接",
          detail: `${options.entityId}:${options.storageSlotGroupId}.${options.slotId} -> ${options.itemId}`,
          entityIds: [options.entityId],
          definitionIds: [entity.definitionId],
          count: 1,
        },
        update: (documentSnapshot) => {
          // 基于当前快照实时过滤，移除同一设备同一槽位的旧链接（幂等覆盖）
          const filteredLinks = documentSnapshot.slotLinks.filter(
            (link) => !isWarehouseSlotLinkForSlot(link, options.entityId, options.storageSlotGroupId, options.slotId),
          );
          return {
            ...documentSnapshot,
            slotLinks: [...filteredLinks, nextLink],
          };
        },
      });

      return committedDocument !== null;
    }),

    removeWarehouseSlotLink: action((entityId, storageSlotGroupId, slotId) => {
      const currentDocument = document.getSnapshot();
      const existingLink = currentDocument.slotLinks.find(
        (link) => isWarehouseSlotLinkForSlot(link, entityId, storageSlotGroupId, slotId),
      );

      if (existingLink === undefined) {
        return false;
      }

      const committedDocument = documentWriter.commit({
        action: {
          type: "document.unknown",
          label: "移除仓库物品链接",
          detail: `${entityId}:${storageSlotGroupId}.${slotId}`,
          entityIds: [entityId],
          count: 1,
        },
        update: (documentSnapshot) => ({
          ...documentSnapshot,
          slotLinks: documentSnapshot.slotLinks.filter(
            (link) => link.id !== existingLink.id,
          ),
        }),
      });

      return committedDocument !== null;
    }),
  };
}

function isWarehouseSlotLinkForSlot(
  link: SlotLinkDefinition,
  entityId: string,
  storageSlotGroupId: string,
  slotId: string,
): boolean {
  return link.source.entityId === entityId
    && link.source.storageSlotGroupId === storageSlotGroupId
    && link.source.slotId === slotId
    && link.target.entityId === "warehouse";
}
