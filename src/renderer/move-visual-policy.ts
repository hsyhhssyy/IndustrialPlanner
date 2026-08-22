import type { UiState } from "@/domain/app/types/app-types";

export function isBatchMove(moveKind: UiState["moveKind"]): boolean {
  return moveKind === "batch";
}

export function resolveBatchMoveHiddenRangeEntityIds(
  moveKind: UiState["moveKind"],
  previewEntityIds: readonly string[],
  ghostEntityIds: readonly string[],
): ReadonlySet<string> {
  if (!isBatchMove(moveKind)) {
    return new Set();
  }

  return new Set([...ghostEntityIds, ...previewEntityIds]);
}

export function shouldUseGroupedPreviewVisuals(
  moveKind: UiState["moveKind"],
  previewCount: number,
): boolean {
  if (moveKind !== null) {
    return isBatchMove(moveKind);
  }

  return previewCount > 1;
}

export function resolveStrongPortOverlayEntityIds(
  moveKind: UiState["moveKind"],
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
