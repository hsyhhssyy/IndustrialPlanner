import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

// AI-REMOVED 2026-09-24:
// Reason: 切换所需的加载与默认实体补全已由文档管理器接管。
// Trigger: REQ-038 驻留文档切换。
// Evidence: loadLatestBaseDocument 改为调用 documents.activate。
// Replacement: document-storage.ts createEditorDocumentRepository。
// Risk: Low
// Human Review: Required
// Original code:
// import { createWorldDocument } from "@/domain/document/world-document";
// import {
//   resolveLatestWorldDocumentForBase,
// } from "../document-storage";
// import { ensureProtocolCoreEntity } from "../ensure-protocol-core";
import { createLogger } from "@/shared/logging/logger";
import type { EditorStateReadWrite } from "../state-impl";
import { action, runInAction } from "mobx";
import type { EditorActionsContext } from "./types";
import { listWorldDocuments, WORLD_DOCUMENT_DATABASE_LOCATION } from "@/shared/storage/world-document-storage";
import { applyIndexedDbStoreMutations } from "@/shared/storage/browser-storage";
import { emitStorageChange } from "@/shared/storage/storage-change-event";
import { ensureProtocolCoreEntity } from "../ensure-protocol-core";

const logger = createLogger("document-action");

type EditorDocumentActions = Pick<
  EditorAction,
  "applySynchronizedDocument" | "removeSynchronizedBaseDocument" | "loadLatestBaseDocument" | "writeDocumentSettings"
>;

export function createEditorDocumentActions({
  document,
  documentWriter,
  documents,
  flushViewportSettings,
  state,
  workspace,
}: EditorActionsContext): EditorDocumentActions {
  return {
    // AI-REMOVED 2026-09-25:
    // Reason: 同步必须更新后台基地并与自动保存协调，不能只替换活动快照。
    // Trigger: REQ-038 D09 已获确认。
    // Evidence: 原 documentKey guard 会忽略非当前基地的下载。
    // Replacement: documents.applyRemote。
    // Risk: 保存失败会明确拒绝，同步层不得推进成功基线。
    // Human Review: Required
    // Original code:
    // applySynchronizedDocument: action((nextDocument) => {
    //   if (document.getSnapshot().documentKey !== nextDocument.documentKey) {
    //     return;
    //   }
    //   resetDocumentRuntimeState(state);
    //   documentWriter.setSnapshot(nextDocument, { mode: "remote-sync" });
    // }),
    applySynchronizedDocument: action(async (nextDocument) => {
      await documents.ready();
      if (document.getSnapshot().baseId === nextDocument.baseId) {
        flushViewportSettings();
        runInAction(() => resetDocumentRuntimeState(state));
      }
      await documents.applyRemote(nextDocument);
    }),

    removeSynchronizedBaseDocument: action(async (baseId) => {
      await documents.ready();
      if (document.getSnapshot().baseId === baseId) {
        flushViewportSettings();
        runInAction(() => resetDocumentRuntimeState(state));
      }
      await documents.removeRemote(baseId, async () => {
        const storedDocuments = (await listWorldDocuments()).filter((candidate) => candidate.baseId === baseId);
        const removed = await applyIndexedDbStoreMutations(WORLD_DOCUMENT_DATABASE_LOCATION,
          storedDocuments.map((candidate) => ({ type: "delete" as const, key: candidate.documentKey })),
        );
        if (removed) {
          for (const candidate of storedDocuments) emitStorageChange({
            assetType: "world-document", assetId: candidate.documentKey, origin: "remote-sync", timestamp: Date.now(),
          });
        }
        return removed;
      }, () => ensureProtocolCoreEntity({
        document: createWorldDocument({ baseId }), queries: workspace.registry.queries,
      }));
    }),

    loadLatestBaseDocument: action(async (baseId) => {
      if (!workspace.registry.baseDefinitions.some((definition) => definition.id === baseId)) {
        logger.warn("loadLatestBaseDocument invalid baseId", { baseId });
        return false;
      }
      try {
        return await documents.activate(baseId, () => {
          flushViewportSettings();
          runInAction(() => resetDocumentRuntimeState(state));
        });
      } catch (error) {
        logger.error("Failed to activate base document.", { baseId, error: String(error) });
        return false;
      }
    }),

    // AI-REMOVED 2026-09-24:
    // Reason: 基地切换改用 Editor 驻留文档，不再每次读取存储。
    // Trigger: REQ-038 要求切换复用最新内存版本，防止未落盘编辑丢失。
    // Evidence: 原 resolveLatestWorldDocumentForBase 总是读取 IndexedDB。
    // Replacement: EditorDocumentRepository.activate。
    // Risk: 快速切换、视口保存和初始化顺序需要回归。
    // Human Review: Required
    //
    // Original code:
    //     loadLatestBaseDocument: action(async (baseId) => {
    //       logger.info("loadLatestBaseDocument start", { baseId });
    //
    //       if (!workspace.registry.baseDefinitions.some((definition) => definition.id === baseId)) {
    //         logger.warn("loadLatestBaseDocument invalid baseId", { baseId });
    //         return false;
    //       }
    //
    //       const latestDocument = await resolveLatestWorldDocumentForBase({
    //         baseId,
    //         latestDocumentIdByBaseId: state.internalPersistState.latestDocumentIdByBaseId,
    //       });
    //
    //       logger.info("loadLatestBaseDocument resolved", {
    //         baseId,
    //         foundExisting: latestDocument !== null,
    //         entityCount: latestDocument !== null ? Object.keys(latestDocument.entities).length : 0,
    //       });
    //
    //       const nextDocument = ensureProtocolCoreEntity({
    //         document: latestDocument ?? createWorldDocument({ baseId }),
    //         queries: workspace.registry.queries,
    //       });
    //
    //       logger.info("loadLatestBaseDocument done", {
    //         baseId,
    //         documentKey: nextDocument.documentKey,
    //         entityCount: Object.keys(nextDocument.entities).length,
    //         hasProtocolCore: Object.values(nextDocument.entities).some(
    //           (e) => workspace.registry.queries.isProtocolCore(e.definitionId),
    //         ),
    //       });
    //
    //       runInAction(() => {
    //         resetDocumentRuntimeState(state);
    //         document.setSnapshot(nextDocument);
    //       });
    //
    //       return true;
    //     }),

    writeDocumentSettings: (patch) => {
      const currentDocument = document.getSnapshot();
      const nextDocument: WorldDocument = {
        ...currentDocument,
        documentSettings: {
          ...currentDocument.documentSettings,
          ...patch,
        },
      };

      if (nextDocument.documentSettings === currentDocument.documentSettings) {
        return;
      }

      documentWriter.setSnapshot(nextDocument, { mode: "silent" });
    },
  };
}

function resetDocumentRuntimeState(state: EditorStateReadWrite): void {
  state.drafts = [];
  state.marqueeGridRect = null;
  state.internalTransientState.logisticsDraft = null;
  state.internalTransientState.logisticsDeviceRouteCycleSignature = null;
  state.internalTransientState.logisticsDeviceRouteCycleIndex = 0;
  // AI-REMOVED 2026-09-15:
  // Reason: 物流预览应由当前拓扑和鼠标位置决定，删除上一帧汇流器预览的拦截及专用状态。
  // Trigger: 用户明确允许汇流器预览在鼠标移过交叉点后变为桥接器。
  // Evidence: logistics-placement-complete.test.ts 中当前规划已生成 pipe_connector，历史状态却将草稿判为 unknown。
  // Replacement: rebuildLogisticsDraft 中 resolveAutoDraftPlan 与 resolveInvalidReason 的当前规划结果。
  // Risk: 传送带和管道共享此规则，需验证终点汇流、正交穿越及非法重叠。
  // Human Review: Required
  //
  // Original code:
  // state.internalTransientState.convergerEntityGridKey = null;
  state.internalTransientState.placementDraftSlotLinks = null;
  state.internalTransientState.placementDraftEntityIdMap = null;
  state.internalTransientState.placementHistoryAction = null;
  state.internalTransientState.placementValidationByEntityId = {};
  state.regionAnnotations.selectedId = null;
  state.regionAnnotations.hoveredId = null;
  state.regionAnnotations.hiddenIds.replace([]);
  state.regionAnnotations.draft = null;
  state.regionAnnotations.draftOperation = "add";
  state.regionAnnotations.draftMarqueeGridRect = null;
  state.regionAnnotations.placementPreview = [];
  state.regionAnnotations.moveFeedback = null;

  for (const collectionType of Object.values(EntityCollectionType)) {
    state.collections[collectionType].replace([]);
  }
}
