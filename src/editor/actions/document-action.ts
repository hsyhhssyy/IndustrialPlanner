import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EditorAction } from "@/domain/editor/editor-action";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

import {
  resolveLatestWorldDocumentForBase,
} from "../document-storage";
import { ensureProtocolCoreEntity } from "../ensure-protocol-core";
import { createLogger } from "@/shared/logging/logger";
import type { EditorStateReadWrite } from "../state-impl";
import { action, runInAction } from "mobx";
import type { EditorActionsContext } from "./types";

const logger = createLogger("document-action");

type EditorDocumentActions = Pick<
  EditorAction,
  "applySynchronizedDocument" | "loadLatestBaseDocument" | "writeDocumentSettings"
>;

export function createEditorDocumentActions({
  document,
  documentWriter,
  state,
  workspace,
}: EditorActionsContext): EditorDocumentActions {
  return {
    applySynchronizedDocument: action((nextDocument) => {
      if (document.getSnapshot().documentKey !== nextDocument.documentKey) {
        return;
      }

      resetDocumentRuntimeState(state);
      documentWriter.setSnapshot(nextDocument, { mode: "remote-sync" });
    }),

    loadLatestBaseDocument: action(async (baseId) => {
      logger.info("loadLatestBaseDocument start", { baseId });

      if (!workspace.registry.baseDefinitions.some((definition) => definition.id === baseId)) {
        logger.warn("loadLatestBaseDocument invalid baseId", { baseId });
        return false;
      }

      const latestDocument = await resolveLatestWorldDocumentForBase({
        baseId,
        latestDocumentIdByBaseId: state.internalPersistState.latestDocumentIdByBaseId,
      });

      logger.info("loadLatestBaseDocument resolved", {
        baseId,
        foundExisting: latestDocument !== null,
        entityCount: latestDocument !== null ? Object.keys(latestDocument.entities).length : 0,
      });

      const nextDocument = ensureProtocolCoreEntity({
        document: latestDocument ?? createWorldDocument({ baseId }),
        queries: workspace.registry.queries,
      });

      logger.info("loadLatestBaseDocument done", {
        baseId,
        documentKey: nextDocument.documentKey,
        entityCount: Object.keys(nextDocument.entities).length,
        hasProtocolCore: Object.values(nextDocument.entities).some(
          (e) => workspace.registry.queries.isProtocolCore(e.definitionId),
        ),
      });

      runInAction(() => {
        resetDocumentRuntimeState(state);
        document.setSnapshot(nextDocument);
      });

      return true;
    }),

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
