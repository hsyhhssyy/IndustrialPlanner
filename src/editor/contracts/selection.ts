export type EditorSelectionUpdateMode = "replace" | "toggle";

export function resolveNextSelection(
  currentSelection: readonly string[],
  entityId: string,
  mode: EditorSelectionUpdateMode,
): string[] {
  if (mode === "replace") {
    return [entityId];
  }

  if (currentSelection.includes(entityId)) {
    return currentSelection.filter((selectedId) => selectedId !== entityId);
  }

  return [...currentSelection, entityId];
}

export function resolveMarqueeSelection(
  baseSelection: readonly string[],
  entityIds: readonly string[],
  selectionMode: EditorSelectionUpdateMode,
): string[] {
  if (selectionMode === "replace") {
    return [...entityIds];
  }

  let nextSelection = [...baseSelection];

  for (const entityId of entityIds) {
    nextSelection = resolveNextSelection(nextSelection, entityId, "toggle");
  }

  return nextSelection;
}
