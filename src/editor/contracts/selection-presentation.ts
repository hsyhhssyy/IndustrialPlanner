import type { EditorSession } from "@/editor/contracts/editor-session";
import { getSelectedEntityIds } from "@/editor/contracts/editor-session-helpers";

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

function areStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function splitProjectedSelection(
  ids: readonly string[],
  session: EditorSession,
): ProjectedSelectionState {
  const worldEntityIds: string[] = [];
  const draftEntityIds: string[] = [];

  for (const id of ids) {
    if (session.drafts.entities[id]) {
      draftEntityIds.push(id);
    } else {
      worldEntityIds.push(id);
    }
  }

  return {
    worldEntityIds,
    draftEntityIds,
  };
}

export function deriveSelectionPresentation(
  session: EditorSession,
): SelectionPresentationState {
  const baselineIds = getSelectedEntityIds(session);
  const projectedIds = session.draftEntities?.ids ?? [];
  const inspectorSource: SelectionInspectorSource = session.marqueeRange
    ? "projected"
    : "baseline";

  return {
    activeSelection:
      inspectorSource === "projected"
        ? splitProjectedSelection(projectedIds, session)
        : splitProjectedSelection(baselineIds, session),
    ghostedWorldEntityIds: projectedIds
      .map((id) => session.drafts.entities[id]?.sourceEntityId)
      .filter((entityId): entityId is string => Boolean(entityId)),
    inspectorSource,
    drawMovePreviewSelectionOutline: false,
  };
}

export function isSameSelectionPresentationState(
  left: SelectionPresentationState | null | undefined,
  right: SelectionPresentationState | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    areStringArraysEqual(
      left.activeSelection.worldEntityIds,
      right.activeSelection.worldEntityIds,
    ) &&
    areStringArraysEqual(
      left.activeSelection.draftEntityIds,
      right.activeSelection.draftEntityIds,
    ) &&
    areStringArraysEqual(left.ghostedWorldEntityIds, right.ghostedWorldEntityIds) &&
    left.inspectorSource === right.inspectorSource &&
    left.drawMovePreviewSelectionOutline === right.drawMovePreviewSelectionOutline
  );
}