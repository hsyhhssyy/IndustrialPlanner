import type { AppHost } from "@/app/host";
import type { SceneAttachmentReference } from "@/domain/document/scene-view-input";
import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import {
  collectPeriodicRangeRegions,
  findPeriodicRangeRegionsAtGridCell,
  isPeriodicRangeConflictReason,
  type PeriodicRangeRegion,
} from "@/shared/periodic-range-conversion";
import type { CanvasInteractionController } from "./canvas-interaction-controller";

interface PeriodicRangeRegionCacheEntry {
  readonly document: WorldDocument;
  readonly registry: AppHost["workspace"]["registry"];
  readonly activityKey: string;
  readonly regions: readonly PeriodicRangeRegion[];
}

const regionCacheByEditor = new WeakMap<EditorContract, PeriodicRangeRegionCacheEntry>();

/** 布局态区域按当前文档与活动筛选缓存；文档快照替换后自动重建。 */
export function resolvePeriodicRangeRegions(
  appHost: AppHost,
  editor: EditorContract,
): readonly PeriodicRangeRegion[] {
  const document = editor.document.getSnapshot();
  const activeActivityIds = resolveEffectiveActivityIds({
    selectedActivityIds: appHost.internalState.settings.selectedActivityIds,
  });
  const activityKey = [...activeActivityIds].sort().join("\u0000");
  const cached = regionCacheByEditor.get(editor);
  if (cached?.document === document && cached.activityKey === activityKey && cached.registry === appHost.workspace.registry) {
    return cached.regions;
  }
  const regions = collectPeriodicRangeRegions({
    document,
    registry: appHost.workspace.registry,
    activeActivityIds,
    isSourceInvalid: (entityId) => editor.queries.getEntityPlacementValidation(entityId)
      .reasons.some((reason) => isPeriodicRangeConflictReason(reason.code)),
  });
  regionCacheByEditor.set(editor, { document, registry: appHost.workspace.registry, activityKey, regions });
  return regions;
}

export function resolvePeriodicRangeAttachmentCandidatesAtClientPoint(options: {
  canvas: CanvasInteractionController;
  appHost: AppHost;
  editor: EditorContract;
  position: ClientPixelPoint;
}): readonly PeriodicRangeRegion[] {
  const cell = options.canvas.view.queries.findGridCellForClientPixelPoint(options.position);
  if (cell === null) return [];
  return findPeriodicRangeRegionsAtGridCell(
    resolvePeriodicRangeRegions(options.appHost, options.editor),
    cell,
  );
}

export function resolvePeriodicRangeRegionByReference(options: {
  appHost: AppHost;
  editor: EditorContract;
  reference: SceneAttachmentReference;
}): PeriodicRangeRegion | null {
  const document = options.editor.document.getSnapshot();
  if (options.reference.documentKey !== document.documentKey) return null;
  return resolvePeriodicRangeRegions(options.appHost, options.editor)
    .find((region) => region.regionId === options.reference.regionId) ?? null;
}

export function createSceneAttachmentReference(region: PeriodicRangeRegion): SceneAttachmentReference {
  return {
    kind: "periodic-range",
    documentKey: region.documentKey,
    regionId: region.regionId,
    gridRect: { ...region.gridRect },
  };
}

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 物料关系、分层概率和投影范围分别由配方行为及本地口声明。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: registry/recipe-definition.ts、registry/entity-definition.ts 与 shared/formation-recipes.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//   if (cached?.document === document && cached.activityKey === activityKey) {
//
//   regionCacheByEditor.set(editor, { document, activityKey, regions });
