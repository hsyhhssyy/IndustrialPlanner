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