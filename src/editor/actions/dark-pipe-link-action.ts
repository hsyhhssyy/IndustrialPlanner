import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldDocument } from "@/domain/document/world-document";
import type { RegionalDarkPipeEndpoint } from "@/domain/shared/dark-pipe-link";
import { reaction } from "mobx";
import {
  createDarkPipeSlotLink,
  createRegionalDarkPipeLink,
  findDarkPipeSlotLinkForEntity,
  findRegionalDarkPipeLinkForEndpoint,
  isSameRegionalDarkPipeEndpoint,
  listDocumentRegionalDarkPipeLinks,
  prepareDarkPipeLinkDocument,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { createLogger } from "@/shared/logging/logger";
import { createWorldDocumentDelta } from "../history";
import type { EditorDocumentChange } from "../document-repository";
import { emitEditorDocumentChanges, persistEditorDocumentChanges } from "../document-transactions";
import type { EditorActionsContext } from "./types";

const logger = createLogger("dark-pipe-link-action");
type EditorDarkPipeLinkActions = Pick<EditorAction, "createDarkPipeLink" | "removeDarkPipeLink">;

export function createEditorDarkPipeLinkActions(context: EditorActionsContext): EditorDarkPipeLinkActions {
  const { document, documents, workspace, history } = context;
  const multiBaseEnabled = () => workspace.app?.state.settings.regionalMultiBaseEnabled === true;

  const regionDocuments = async (baseId: string): Promise<readonly WorldDocument[]> => {
    const region = workspace.registry.baseDefinitions.find(base => base.id === baseId)?.tag;
    if (region === undefined) return [];
    return documents.readMany(workspace.registry.baseDefinitions.filter(base => base.tag === region).map(base => base.id));
  };

  const createOperationGuard = (regional: boolean): (() => boolean) => {
    const activeKey = document.getSnapshot().documentKey;
    const enabled = multiBaseEnabled();
    const selection = workspace.app?.state.toolInfo.darkPipeLink;
    return () => document.getSnapshot().documentKey === activeKey
      && multiBaseEnabled() === enabled
      && (selection == null || workspace.app?.state.toolInfo.darkPipeLink === selection)
      && (!regional || (enabled && workspace.simulation?.engineKind === "dense-v2"
        && workspace.simulation.state.runningState === "stop"));
  };

  const commit = async (changes: readonly EditorDocumentChange[], isCurrent: () => boolean, label: string): Promise<boolean> => {
    const changed = changes.filter(change => change.before !== change.after);
    if (changed.length === 0 || !isCurrent()) return false;
    for (const { after } of changed) await history.prepareDocumentHistory(after.documentKey);
    const cancellation = new AbortController();
    const stop = reaction(isCurrent, current => { if (!current) cancellation.abort(); });
    try {
      const saved = await documents.commit(changes,
        signal => persistEditorDocumentChanges(changes, signal), isCurrent, cancellation.signal);
      if (!saved) return false;
      for (const { before, after } of changed) {
        const delta = createWorldDocumentDelta(before, after);
        if (delta !== null) history.record({ documentKey: after.documentKey, action: { type: "document.unknown", label }, delta });
      }
      emitEditorDocumentChanges(changed);
      return true;
    } finally {
      stop();
    }
  };

  return {
    async createDarkPipeLink(options) {
      try {
        await documents.ready();
        // 先归并选点前的视口变化，避免延迟保存使本次关系事务误判为并发编辑。
        context.flushViewportSettings();
        const activeBaseId = document.getSnapshot().baseId;
        const sourceEndpoint = { baseId: options.sourceBaseId ?? activeBaseId, entityId: options.sourceEntityId };
        const targetEndpoint = { baseId: options.targetBaseId ?? activeBaseId, entityId: options.targetEntityId };
        if (isSameRegionalDarkPipeEndpoint(sourceEndpoint, targetEndpoint)) return false;
        const regional = sourceEndpoint.baseId !== targetEndpoint.baseId;
        const isCurrent = createOperationGuard(regional);
        if (!isCurrent()) return false;
        // 单基地下显式重新配置也要查找旧的远端占用，避免重新开启时旧连接复活。
        const snapshots = await regionDocuments(sourceEndpoint.baseId);
        const sourceDocument = snapshots.find(snapshot => snapshot.baseId === sourceEndpoint.baseId);
        const targetDocument = snapshots.find(snapshot => snapshot.baseId === targetEndpoint.baseId);
        const source = sourceDocument?.entities[sourceEndpoint.entityId];
        const target = targetDocument?.entities[targetEndpoint.entityId];
        if (sourceDocument === undefined || targetDocument === undefined || source === undefined || target === undefined) return false;
        const sourceRole = resolveDarkPipeRole(source.definitionId);
        const targetRole = resolveDarkPipeRole(target.definitionId);
        if (sourceRole === null || targetRole === null || sourceRole === targetRole) return false;
        if (findDarkPipeSlotLinkForEntity(sourceDocument, source.id) !== null
          || findDarkPipeSlotLinkForEntity(targetDocument, target.id) !== null) return false;

        const relations = listDocumentRegionalDarkPipeLinks(snapshots);
        const conflicts = relations.filter(link => [link.inlet, link.outlet].some(endpoint =>
          isSameRegionalDarkPipeEndpoint(endpoint, sourceEndpoint) || isSameRegionalDarkPipeEndpoint(endpoint, targetEndpoint)));
        if (multiBaseEnabled() && conflicts.length > 0) return false;
        const inlet = sourceRole === "inlet" ? sourceEndpoint : targetEndpoint;
        const outlet = sourceRole === "outlet" ? sourceEndpoint : targetEndpoint;
        const relative = createDarkPipeSlotLink({ inletEntityId: inlet.entityId, outletEntityId: outlet.entityId });
        const nextLink = regional ? {
          ...relative,
          id: createRegionalDarkPipeLink({ inlet, outlet }).id,
          target: { ...relative.target, baseId: inlet.baseId },
        } : relative;
        const timestamp = new Date().toISOString();
        const changes = snapshots.map(before => {
          let after = prepareDarkPipeLinkDocument(before, [inlet, outlet].filter(endpoint => endpoint.baseId === before.baseId).map(endpoint => endpoint.entityId));
          const removedIds = new Set(conflicts.filter(link => link.outlet.baseId === before.baseId).map(link => link.id));
          if (removedIds.size > 0) after = { ...after, slotLinks: after.slotLinks.filter(link => !removedIds.has(link.id)) };
          if (before.baseId === outlet.baseId) after = { ...after, slotLinks: [...after.slotLinks, nextLink] };
          if (before !== after) after = { ...after, meta: { ...after.meta, updatedAt: timestamp } };
          return { before, after };
        });
        return await commit(changes, isCurrent, "创建暗管链接");
      } catch (error) {
        logger.error("Failed to create dark-pipe link.", { error: String(error) });
        return false;
      }
    },

    async removeDarkPipeLink(entityId) {
      try {
        await documents.ready();
        context.flushViewportSettings();
        const active = document.getSnapshot();
        const baseGuard = createOperationGuard(false);
        const endpoint: RegionalDarkPipeEndpoint = { baseId: active.baseId, entityId };
        const local = findDarkPipeSlotLinkForEntity(active, entityId);
        const snapshots = await regionDocuments(active.baseId);
        const regional = local === null ? findRegionalDarkPipeLinkForEndpoint(listDocumentRegionalDarkPipeLinks(snapshots), endpoint) : null;
        if (local === null && regional === null) return false;
        const isCurrent = () => baseGuard() && document.getSnapshot() === active
          && (regional === null || (multiBaseEnabled() && workspace.simulation?.engineKind === "dense-v2"
            && workspace.simulation.state.runningState === "stop"));
        if (!isCurrent()) return false;
        const ownerBaseId = regional?.outlet.baseId ?? active.baseId;
        const linkId = regional?.id ?? local!.id;
        const endpoints = regional === null
          ? [{ baseId: active.baseId, entityId: local!.source.entityId }, { baseId: active.baseId, entityId: local!.target.entityId }]
          : [regional.inlet, regional.outlet];
        const timestamp = new Date().toISOString();
        const changes = snapshots.map(before => {
          let after = prepareDarkPipeLinkDocument(before, endpoints.filter(candidate => candidate.baseId === before.baseId).map(candidate => candidate.entityId));
          if (before.baseId === ownerBaseId) after = { ...after, slotLinks: after.slotLinks.filter(link => link.id !== linkId) };
          if (before !== after) after = { ...after, meta: { ...after.meta, updatedAt: timestamp } };
          return { before, after };
        });
        return await commit(changes, isCurrent, "断开暗管链接");
      } catch (error) {
        logger.error("Failed to remove dark-pipe link.", { error: String(error) });
        return false;
      }
    },
  };
}

// AI-REMOVED 2026-09-25:
// Reason: 普通与跨基地建链统一进入 Editor 文档事务，替代仅操作当前文档的同步实现。
// Trigger: REQ-038 D07、D08 已获授权，出口文档作为关系权威。
// Evidence: 原实现不能更新后台出口，也不能原子处理两个文档。
// Replacement: 本文件上方 createEditorDarkPipeLinkActions。
// Risk: 异步调用方、后台历史与失败取消需要回归。
// Human Review: Required
// Original code:
// import type { EditorAction } from "@/domain/editor/editor-action";
// import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
// import {
//   createDarkPipeSlotLink,
//   findDarkPipeSlotLinkForEntity,
//   filterDarkPipeOutletWarehouseLinks,
//   // AI-REMOVED 2026-08-19:
//   // Reason: 暗管入口隐藏销毁配方已退出，创建直连无需再写 manualRecipeOnly。
//   // Trigger: 用户要求两个仿真模式下未直连入口均入仓并抛弃销毁机制。
//   // Evidence: shared/dark-pipe-link.ts 已归档 getDarkPipeManualRecipeOnlyPatch。
//   // Replacement: 创建链接时将入口 config 清空，移除旧文档遗留键。
//   // Risk: Low
//   // Human Review: Required
//   //
//   // Original code:
//   // getDarkPipeManualRecipeOnlyPatch,
//   isEntityInDarkPipeLink,
//   resolveDarkPipeRole,
// } from "@/shared/dark-pipe-link";
// import { action } from "mobx";
//
// import type { EditorActionsContext } from "./types";
//
// type EditorDarkPipeLinkActions = Pick<EditorAction, "createDarkPipeLink" | "removeDarkPipeLink">;
//
// export function createEditorDarkPipeLinkActions({
//   document,
//   documentWriter,
//   // AI-REMOVED 2026-08-19:
//   // Reason: workspace 仅用于查找入口定义并生成 manualRecipeOnly；销毁 channel 退出后不再需要 Registry 查询。
//   // Trigger: 用户要求抛弃暗管入口销毁机制。
//   // Evidence: createDarkPipeLink 只需文档快照、角色解析和 Slot Link 写入。
//   // Replacement: None
//   // Risk: Low
//   // Human Review: Required
//   //
//   // Original code:
//   // workspace,
// }: EditorActionsContext): EditorDarkPipeLinkActions {
//   return {
//     createDarkPipeLink: action((options) => {
//       const currentDocument = document.getSnapshot();
//       const resolved = resolveDarkPipeLinkPair({
//         document: currentDocument,
//         sourceEntityId: options.sourceEntityId,
//         targetEntityId: options.targetEntityId,
//       });
//
//       if (resolved === null) {
//         return false;
//       }
//
//       // AI-REMOVED 2026-08-19:
//       // Reason: 入口定义查询只服务于隐藏销毁 channel 的 manualRecipeOnly 配置，现已无业务作用。
//       // Trigger: 用户要求暗管入口未直连时统一入仓并抛弃销毁机制。
//       // Evidence: resolveDarkPipeLinkPair 已根据已知暗管 definition ID 验证入口角色。
//       // Replacement: None
//       // Risk: Low
//       // Human Review: Required
//       //
//       // Original code:
//       // const inletDefinition = workspace.registry.entityDefinitions.find(
//       //   (definition) => definition.id === resolved.inlet.definitionId,
//       // );
//       // if (inletDefinition === undefined) {
//       //   return false;
//       // }
//
//       const nextLink = createDarkPipeSlotLink({
//         inletEntityId: resolved.inlet.id,
//         outletEntityId: resolved.outlet.id,
//       });
//       // AI-REMOVED 2026-08-19:
//       // Reason: 暗管直连不再需要停用销毁 channel。
//       // Trigger: 用户要求抛弃销毁机制。
//       // Evidence: udpipe_loader_1/2 的 recipeChannels 已为空。
//       // Replacement: 下方入口 config 直接清空。
//       // Risk: Low
//       // Human Review: Required
//       //
//       // Original code:
//       // const nextInletConfig = getDarkPipeManualRecipeOnlyPatch(inletDefinition);
//
//       const committedDocument = documentWriter.commit({
//         action: {
//           type: "document.unknown",
//           label: "创建暗管链接",
//           detail: `${resolved.outlet.id} -> ${resolved.inlet.id}`,
//           entityIds: [resolved.outlet.id, resolved.inlet.id],
//           definitionIds: [resolved.outlet.definitionId, resolved.inlet.definitionId],
//           count: 1,
//         },
//         update: (documentSnapshot) => {
//           const snapshotResolved = resolveDarkPipeLinkPair({
//             document: documentSnapshot,
//             sourceEntityId: options.sourceEntityId,
//             targetEntityId: options.targetEntityId,
//           });
//           if (snapshotResolved === null) {
//             return documentSnapshot;
//           }
//
//           const inlet = documentSnapshot.entities[snapshotResolved.inlet.id];
//           const outlet = documentSnapshot.entities[snapshotResolved.outlet.id];
//           if (inlet === undefined || outlet === undefined) {
//             return documentSnapshot;
//           }
//
//           return {
//             ...documentSnapshot,
//             entities: {
//               ...documentSnapshot.entities,
//               [inlet.id]: {
//                 ...inlet,
//                 // AI-CORRECTION 2026-08-19: 不再生成 manualRecipeOnly；清空 config 可同时移除旧文档遗留的销毁 channel 配置。
//                 config: {},
//               },
//               [outlet.id]: {
//                 ...outlet,
//                 config: {},
//               },
//             },
//             slotLinks: [
//               // AI-REMOVED 2026-08-19:
//               // Reason: 暗管出口切换为暗管直连后，原仓库 share-all 必须同时移除，否则同一出口形成两个 share-all 来源链接。
//               // Trigger: 用户报告创建暗管直连会遗留出口仓库链接，形成双重 share-all。
//               // Evidence: 原实现只清空 outlet.config，但仓库链接已迁移到 document.slotLinks，不会随 config 清空。
//               // Replacement: filterDarkPipeOutletWarehouseLinks。
//               // Risk: Low - 只删除当前出口精确槽位指向仓库的 share-all，其他设备链接保持不变。
//               // Human Review: Required
//               //
//               // Original code:
//               // ...documentSnapshot.slotLinks,
//               ...filterDarkPipeOutletWarehouseLinks(
//                 documentSnapshot.slotLinks,
//                 snapshotResolved.outlet.id,
//               ),
//               nextLink,
//             ],
//           };
//         },
//       });
//
//       return committedDocument !== null;
//     }),
//
//     removeDarkPipeLink: action((entityId) => {
//       const currentDocument = document.getSnapshot();
//       const link = findDarkPipeSlotLinkForEntity(currentDocument, entityId);
//       if (link === null) {
//         return false;
//       }
//
//       const sourceEntity = currentDocument.entities[link.source.entityId];
//       const targetEntity = currentDocument.entities[link.target.entityId];
//       if (sourceEntity === undefined || targetEntity === undefined) {
//         return false;
//       }
//
//       const committedDocument = documentWriter.commit({
//         action: {
//           type: "document.unknown",
//           label: "断开暗管链接",
//           detail: `${link.source.entityId} -> ${link.target.entityId}`,
//           entityIds: [link.source.entityId, link.target.entityId],
//           definitionIds: [sourceEntity.definitionId, targetEntity.definitionId],
//           count: 1,
//         },
//         update: (documentSnapshot) => {
//           const snapshotLink = findDarkPipeSlotLinkForEntity(documentSnapshot, entityId);
//           if (snapshotLink === null) {
//             return documentSnapshot;
//           }
//
//           const snapshotSource = documentSnapshot.entities[snapshotLink.source.entityId];
//           const snapshotTarget = documentSnapshot.entities[snapshotLink.target.entityId];
//           if (snapshotSource === undefined || snapshotTarget === undefined) {
//             return documentSnapshot;
//           }
//
//           return {
//             ...documentSnapshot,
//             entities: {
//               ...documentSnapshot.entities,
//               [snapshotSource.id]: {
//                 ...snapshotSource,
//                 config: {},
//               },
//               [snapshotTarget.id]: {
//                 ...snapshotTarget,
//                 config: {},
//               },
//             },
//             slotLinks: documentSnapshot.slotLinks.filter((slotLink) => slotLink.id !== snapshotLink.id),
//           };
//         },
//       });
//
//       return committedDocument !== null;
//     }),
//   };
// }
//
// // AI-REMOVED 2026-09-24:
// // Reason: 普通与跨基地链接必须共用仓库来源互斥规则。
// // Trigger: 用户要求两种建链都清除出口仓库链接。
// // Evidence: 原过滤函数仅存在于 Editor，本次跨基地事务和 Dense 合图也需要使用。
// // Replacement: src/shared/dark-pipe-link.ts filterDarkPipeOutletWarehouseLinks。
// // Risk: Low
// // Human Review: Required
// // Original code:
// // function filterDarkPipeOutletWarehouseLinks(
// //   slotLinks: WorldDocument["slotLinks"],
// //   outletEntityId: string,
// // ): WorldDocument["slotLinks"] {
// //   return slotLinks.filter((slotLink) => !(
// //     slotLink.linkType === "share-all"
// //     && slotLink.source.entityId === outletEntityId
// //     && slotLink.source.storageSlotGroupId === "unloader_buffer"
// //     && slotLink.source.slotId === "slot_1"
// //     && (
// //       slotLink.target.entityId === "warehouse"
// //       || slotLink.target.entityId.startsWith("warehouse:")
// //     )
// //     && slotLink.target.storageSlotGroupId === "warehouse"
// //   ));
// // }
//
// function resolveDarkPipeLinkPair(options: {
//   document: WorldDocument;
//   sourceEntityId: string;
//   targetEntityId: string;
// }): {
//   inlet: WorldEntity;
//   outlet: WorldEntity;
// } | null {
//   if (options.sourceEntityId === options.targetEntityId) {
//     return null;
//   }
//
//   const source = options.document.entities[options.sourceEntityId];
//   const target = options.document.entities[options.targetEntityId];
//   if (source === undefined || target === undefined) {
//     return null;
//   }
//
//   const sourceRole = resolveDarkPipeRole(source.definitionId);
//   const targetRole = resolveDarkPipeRole(target.definitionId);
//   if (sourceRole === null || targetRole === null || sourceRole === targetRole) {
//     return null;
//   }
//
//   if (
//     isEntityInDarkPipeLink(options.document, source.id)
//     || isEntityInDarkPipeLink(options.document, target.id)
//   ) {
//     return null;
//   }
//
//   return sourceRole === "inlet"
//     ? { inlet: source, outlet: target }
//     : { inlet: target, outlet: source };
// }
