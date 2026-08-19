import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import {
  createDarkPipeSlotLink,
  findDarkPipeSlotLinkForEntity,
  // AI-REMOVED 2026-08-19:
  // Reason: 暗管入口隐藏销毁配方已退出，创建直连无需再写 manualRecipeOnly。
  // Trigger: 用户要求两个仿真模式下未直连入口均入仓并抛弃销毁机制。
  // Evidence: shared/dark-pipe-link.ts 已归档 getDarkPipeManualRecipeOnlyPatch。
  // Replacement: 创建链接时将入口 config 清空，移除旧文档遗留键。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // getDarkPipeManualRecipeOnlyPatch,
  isEntityInDarkPipeLink,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { action } from "mobx";

import type { EditorActionsContext } from "./types";

type EditorDarkPipeLinkActions = Pick<EditorAction, "createDarkPipeLink" | "removeDarkPipeLink">;

export function createEditorDarkPipeLinkActions({
  document,
  documentWriter,
  // AI-REMOVED 2026-08-19:
  // Reason: workspace 仅用于查找入口定义并生成 manualRecipeOnly；销毁 channel 退出后不再需要 Registry 查询。
  // Trigger: 用户要求抛弃暗管入口销毁机制。
  // Evidence: createDarkPipeLink 只需文档快照、角色解析和 Slot Link 写入。
  // Replacement: None
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // workspace,
}: EditorActionsContext): EditorDarkPipeLinkActions {
  return {
    createDarkPipeLink: action((options) => {
      const currentDocument = document.getSnapshot();
      const resolved = resolveDarkPipeLinkPair({
        document: currentDocument,
        sourceEntityId: options.sourceEntityId,
        targetEntityId: options.targetEntityId,
      });

      if (resolved === null) {
        return false;
      }

      // AI-REMOVED 2026-08-19:
      // Reason: 入口定义查询只服务于隐藏销毁 channel 的 manualRecipeOnly 配置，现已无业务作用。
      // Trigger: 用户要求暗管入口未直连时统一入仓并抛弃销毁机制。
      // Evidence: resolveDarkPipeLinkPair 已根据已知暗管 definition ID 验证入口角色。
      // Replacement: None
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const inletDefinition = workspace.registry.entityDefinitions.find(
      //   (definition) => definition.id === resolved.inlet.definitionId,
      // );
      // if (inletDefinition === undefined) {
      //   return false;
      // }

      const nextLink = createDarkPipeSlotLink({
        inletEntityId: resolved.inlet.id,
        outletEntityId: resolved.outlet.id,
      });
      // AI-REMOVED 2026-08-19:
      // Reason: 暗管直连不再需要停用销毁 channel。
      // Trigger: 用户要求抛弃销毁机制。
      // Evidence: udpipe_loader_1/2 的 recipeChannels 已为空。
      // Replacement: 下方入口 config 直接清空。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const nextInletConfig = getDarkPipeManualRecipeOnlyPatch(inletDefinition);

      const committedDocument = documentWriter.commit({
        action: {
          type: "document.unknown",
          label: "创建暗管链接",
          detail: `${resolved.outlet.id} -> ${resolved.inlet.id}`,
          entityIds: [resolved.outlet.id, resolved.inlet.id],
          definitionIds: [resolved.outlet.definitionId, resolved.inlet.definitionId],
          count: 1,
        },
        update: (documentSnapshot) => {
          const snapshotResolved = resolveDarkPipeLinkPair({
            document: documentSnapshot,
            sourceEntityId: options.sourceEntityId,
            targetEntityId: options.targetEntityId,
          });
          if (snapshotResolved === null) {
            return documentSnapshot;
          }

          const inlet = documentSnapshot.entities[snapshotResolved.inlet.id];
          const outlet = documentSnapshot.entities[snapshotResolved.outlet.id];
          if (inlet === undefined || outlet === undefined) {
            return documentSnapshot;
          }

          return {
            ...documentSnapshot,
            entities: {
              ...documentSnapshot.entities,
              [inlet.id]: {
                ...inlet,
                // AI-CORRECTION 2026-08-19: 不再生成 manualRecipeOnly；清空 config 可同时移除旧文档遗留的销毁 channel 配置。
                config: {},
              },
              [outlet.id]: {
                ...outlet,
                config: {},
              },
            },
            slotLinks: [
              // AI-REMOVED 2026-08-19:
              // Reason: 暗管出口切换为暗管直连后，原仓库 share-all 必须同时移除，否则同一出口形成两个 share-all 来源链接。
              // Trigger: 用户报告创建暗管直连会遗留出口仓库链接，形成双重 share-all。
              // Evidence: 原实现只清空 outlet.config，但仓库链接已迁移到 document.slotLinks，不会随 config 清空。
              // Replacement: filterDarkPipeOutletWarehouseLinks。
              // Risk: Low - 只删除当前出口精确槽位指向仓库的 share-all，其他设备链接保持不变。
              // Human Review: Required
              //
              // Original code:
              // ...documentSnapshot.slotLinks,
              ...filterDarkPipeOutletWarehouseLinks(
                documentSnapshot.slotLinks,
                snapshotResolved.outlet.id,
              ),
              nextLink,
            ],
          };
        },
      });

      return committedDocument !== null;
    }),

    removeDarkPipeLink: action((entityId) => {
      const currentDocument = document.getSnapshot();
      const link = findDarkPipeSlotLinkForEntity(currentDocument, entityId);
      if (link === null) {
        return false;
      }

      const sourceEntity = currentDocument.entities[link.source.entityId];
      const targetEntity = currentDocument.entities[link.target.entityId];
      if (sourceEntity === undefined || targetEntity === undefined) {
        return false;
      }

      const committedDocument = documentWriter.commit({
        action: {
          type: "document.unknown",
          label: "断开暗管链接",
          detail: `${link.source.entityId} -> ${link.target.entityId}`,
          entityIds: [link.source.entityId, link.target.entityId],
          definitionIds: [sourceEntity.definitionId, targetEntity.definitionId],
          count: 1,
        },
        update: (documentSnapshot) => {
          const snapshotLink = findDarkPipeSlotLinkForEntity(documentSnapshot, entityId);
          if (snapshotLink === null) {
            return documentSnapshot;
          }

          const snapshotSource = documentSnapshot.entities[snapshotLink.source.entityId];
          const snapshotTarget = documentSnapshot.entities[snapshotLink.target.entityId];
          if (snapshotSource === undefined || snapshotTarget === undefined) {
            return documentSnapshot;
          }

          return {
            ...documentSnapshot,
            entities: {
              ...documentSnapshot.entities,
              [snapshotSource.id]: {
                ...snapshotSource,
                config: {},
              },
              [snapshotTarget.id]: {
                ...snapshotTarget,
                config: {},
              },
            },
            slotLinks: documentSnapshot.slotLinks.filter((slotLink) => slotLink.id !== snapshotLink.id),
          };
        },
      });

      return committedDocument !== null;
    }),
  };
}

function filterDarkPipeOutletWarehouseLinks(
  slotLinks: WorldDocument["slotLinks"],
  outletEntityId: string,
): WorldDocument["slotLinks"] {
  return slotLinks.filter((slotLink) => !(
    slotLink.linkType === "share-all"
    && slotLink.source.entityId === outletEntityId
    && slotLink.source.storageSlotGroupId === "unloader_buffer"
    && slotLink.source.slotId === "slot_1"
    && (
      slotLink.target.entityId === "warehouse"
      || slotLink.target.entityId.startsWith("warehouse:")
    )
    && slotLink.target.storageSlotGroupId === "warehouse"
  ));
}

function resolveDarkPipeLinkPair(options: {
  document: WorldDocument;
  sourceEntityId: string;
  targetEntityId: string;
}): {
  inlet: WorldEntity;
  outlet: WorldEntity;
} | null {
  if (options.sourceEntityId === options.targetEntityId) {
    return null;
  }

  const source = options.document.entities[options.sourceEntityId];
  const target = options.document.entities[options.targetEntityId];
  if (source === undefined || target === undefined) {
    return null;
  }

  const sourceRole = resolveDarkPipeRole(source.definitionId);
  const targetRole = resolveDarkPipeRole(target.definitionId);
  if (sourceRole === null || targetRole === null || sourceRole === targetRole) {
    return null;
  }

  if (
    isEntityInDarkPipeLink(options.document, source.id)
    || isEntityInDarkPipeLink(options.document, target.id)
  ) {
    return null;
  }

  return sourceRole === "inlet"
    ? { inlet: source, outlet: target }
    : { inlet: target, outlet: source };
}
