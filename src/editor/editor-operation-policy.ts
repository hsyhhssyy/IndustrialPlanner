import type { EditorAction } from "@/domain/editor/editor-action";
import type { EditorHistoryActionType } from "@/domain/editor/editor-history";
import type { CanvasOperationAvailability, CanvasOperationId } from "@/domain/shared/canvas-operation";
import type { LogisticsDraftActionResult } from "@/domain/shared/logistics";

export const AVAILABLE_OPERATION: CanvasOperationAvailability = Object.freeze({ supported: true, enabled: true, reason: null });

const ACTION_OPERATIONS: Record<keyof EditorAction, CanvasOperationId | null> = {
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: 旧 viewport 已退役；Replacement: EditorView；Risk: 消费者待迁移；Human Review: Required
// Original code:
//   setViewportClientRect: null, moveViewportByClientPixelVector: "pan-viewport", zoom: "zoom-viewport",
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: 旧 viewport 已退役；Replacement: EditorView；Risk: 消费者待迁移；Human Review: Required
// Original code:
//   setViewportDisplayRotation: "rotate-viewport", focusOnEntity: "pan-viewport", focusOnRegion: "pan-viewport",
  setHoverPoint: "select", clearHoverPoint: null,
  patchEntityConfig: "configure-device", deleteEntityConfigKeys: "configure-device",
  createDarkPipeLink: "configure-device", removeDarkPipeLink: "configure-device",
  createWarehouseSlotLink: "configure-device", removeWarehouseSlotLink: "configure-device",
  replaceEntityDefinition: "switch-device-variant",
  clearCollection: null, deleteCollection: "delete", addToCollection: "select", removeFromCollection: "select",
  setMarqueeRange: "marquee-select", applyMarquee: "marquee-select", cancelMarquee: null,
  moveCollectionTo: "move", moveCollectionCenterPointTo: "move", rotateCollection: "rotate-placement",
  rotateCollectionAroundCenterPoint: "rotate-placement", rotateCollectionAroundPivotCell: "rotate-placement",
  rotateCollectionToSnapOnBuilding: "rotate-placement",
  createMoveOperationDraft: "move", applyMoveOerationDraft: "move", cancelMoveOperationDraft: null,
  createSinglePlacementDraft: "confirm-placement", createBlueprintPlacementDraft: "blueprint-placement",
  applyPlacementDraft: "confirm-placement", cancelPlacementDraft: null,
  beginRegionDraft: "region-edit", updateRegionDraft: "region-edit", setRegionDraftOperation: "region-edit",
  setRegionDraftMarquee: "region-edit", applyRegionDraftMarquee: "region-edit", commitRegionDraft: "region-edit",
  cancelRegionDraft: null, deleteRegion: "region-edit", selectRegion: "region-edit", setRegionHovered: "region-edit",
  setRegionVisible: "region-edit", resetRegionInteraction: null,
  createLogisticsDraftStart: "logistics-placement", moveLogisticEnd: "logistics-placement",
  applyLogisticDraft: "logistics-placement", cancelLogisticsDraft: null,
  undoDocumentHistory: "undo", redoDocumentHistory: "redo", restoreDocumentHistoryTo: "undo", clearDocumentHistory: null,
  removeTransportComponent: "delete", removeTransportComponentUpstream: "delete", removeTransportComponentDownstream: "delete",
  loadLatestBaseDocument: null, applySynchronizedDocument: null, removeSynchronizedBaseDocument: null,
  writeDocumentSettings: "configure-device", setLogisticsSuppression: "select",
};

const HISTORY_OPERATIONS: Record<EditorHistoryActionType, CanvasOperationId | null> = {
  "session.intent": "session-intent", "entity.place": "confirm-placement", "blueprint.place": "blueprint-placement",
  "entity.delete": "delete", "entity.move": "move", "entity.rotate": "rotate-placement",
  "entity.definition.replace": "switch-device-variant", "entity.config.patch": "configure-device",
  "entity.config.delete-keys": "configure-device", "logistics.place": "logistics-placement",
  "document.settings.patch": "configure-device", "region.create": "region-edit", "region.edit": "region-edit",
  "region.delete": "region-edit", "document.restore": null, "document.unknown": "configure-device",
};

export function isOperationAvailable(read: (operation: CanvasOperationId) => CanvasOperationAvailability, operation: CanvasOperationId): boolean {
  const availability = read(operation);
  return availability.supported && availability.enabled;
}

export function isHistoryOperationAvailable(read: (operation: CanvasOperationId) => CanvasOperationAvailability, type: EditorHistoryActionType): boolean {
  const operation = HISTORY_OPERATIONS[type];
  return operation === null || isOperationAvailable(read, operation);
}

/** 公共 Editor 入口先拒绝，writer 再校验最终候选，防止直接调用绕过画布能力。 */
export function guardEditorActions(actions: EditorAction, options: {
  readonly getOperationAvailability: (operation: CanvasOperationId) => CanvasOperationAvailability;
  readonly allowDocumentMaintenance: boolean;
  readonly isDisposed: () => boolean;
}): EditorAction {
  const ownerActions = new Set<keyof EditorAction>(["loadLatestBaseDocument", "applySynchronizedDocument", "removeSynchronizedBaseDocument", "writeDocumentSettings"]);
  for (const name of Object.keys(ACTION_OPERATIONS) as Array<keyof EditorAction>) {
    const original = actions[name];
    if (original === undefined) continue;
    const operation = ACTION_OPERATIONS[name];
    Object.defineProperty(actions, name, { configurable: true, enumerable: true, writable: true,
      value: (...args: unknown[]) => {
        if (options.isDisposed() || (!options.allowDocumentMaintenance && ownerActions.has(name))
          || (operation !== null && !isOperationAvailable(options.getOperationAvailability, operation))) {
          return resolveRejectedActionResult(name);
        }
        return Reflect.apply(original, actions, args);
      },
    });
  }
  return actions;
}

function resolveRejectedActionResult(name: keyof EditorAction): unknown {
  if (name === "createDarkPipeLink" || name === "removeDarkPipeLink" || name === "loadLatestBaseDocument") return Promise.resolve(false);
  if (name === "applySynchronizedDocument" || name === "removeSynchronizedBaseDocument") return Promise.resolve();
  if (name === "createLogisticsDraftStart" || name === "moveLogisticEnd") {
    return { status: "ignored", canApply: false, invalidReason: null, headGridPoint: null,
      headDraftEntityId: null, sourceEntityId: null, targetEntityId: null } satisfies LogisticsDraftActionResult;
  }
  return false;
}
