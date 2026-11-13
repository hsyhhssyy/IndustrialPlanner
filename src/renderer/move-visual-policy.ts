import type { ScenePresentation } from "@/domain/document/scene-view-input";
// AI-REMOVED 2026-11-12:
// Reason: 统一场景迁移后旧对象没有有效调用。
// Trigger: REQ-048 P6 与 ESLint unused 审计。
// Evidence: 当前调用由 Canvas 或 SceneViewInput 提供，原引用仅存于审计注释。
// Replacement: CanvasActionImpl / SceneViewInput / 通用只读场景
// Risk: Low
// Human Review: Required
// Original code:
// import type { UiState } from "@/domain/app/types/app-types";

export function isBatchMove(moveKind: ScenePresentation["moveKind"]): boolean {
  return moveKind === "batch";
}

export function resolveBatchMoveHiddenRangeEntityIds(
  moveKind: ScenePresentation["moveKind"],
  previewEntityIds: readonly string[],
  ghostEntityIds: readonly string[],
): ReadonlySet<string> {
  if (!isBatchMove(moveKind)) {
    return new Set();
  }

  return new Set([...ghostEntityIds, ...previewEntityIds]);
}

export function shouldUseGroupedPreviewVisuals(
  moveKind: ScenePresentation["moveKind"],
  previewCount: number,
): boolean {
  if (moveKind !== null) {
    return isBatchMove(moveKind);
  }

  return previewCount > 1;
}

export function resolveStrongPortOverlayEntityIds(
  moveKind: ScenePresentation["moveKind"],
  previewEntityIds: readonly string[],
  selectedEntityIds: readonly string[],
): ReadonlySet<string> {
  if (isBatchMove(moveKind)) {
    return new Set();
  }

  if (previewEntityIds.length === 1) {
    return new Set(previewEntityIds);
  }

  return selectedEntityIds.length === 1
    ? new Set(selectedEntityIds)
    : new Set();
}
