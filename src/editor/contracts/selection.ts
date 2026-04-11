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
