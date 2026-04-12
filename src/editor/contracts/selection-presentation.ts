/**
 * Projected selection is derived state.
 *
 * During Req016 migration it must be fully recomputed from the current
 * baseline selection plus live editor inputs on each update. Incremental delta
 * caches are not part of EditorSession truth.
 */
export interface ProjectedSelectionState {
  worldEntityIds: string[];
  draftEntityIds: string[];
}

export type SelectionInspectorSource = "baseline" | "projected";

export interface SelectionPresentationState {
  activeSelection: ProjectedSelectionState;
  ghostedWorldEntityIds: string[];
  inspectorSource: SelectionInspectorSource;
  drawMovePreviewSelectionOutline: boolean;
}