import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { GridPoint, GridRect } from "@/domain/shared/grid";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphRegionGestureModule(): GestureMappingModule<AppHost> {
  let anchor: GridPoint | null = null;

  return {
    id: "hypergryph-region-gesture",
    when: isHypergryphGestureEnabled,
    acceptsLongPress(context) {
      return context.appHost.state.settings.showRegionAnnotations
        && context.appHost.internalState.activeTool === "region-edit";
    },
    handle(event, context) {
      const editor = context.workspace.editor;

      if (event.type === "on-exit-active-tool") {
        if (event.from !== "region-edit" || event.to === "region-edit") {
          return { status: "ignored" };
        }
        anchor = null;
        editor?.actions.cancelRegionDraft();
        return { status: "handled" };
      }

      if (
        editor === null
        || !context.appHost.state.settings.showRegionAnnotations
        || context.appHost.internalState.activeTool !== "region-edit"
        || editor.state.regionAnnotations.draft === null
      ) {
        return { status: "ignored" };
      }

      switch (event.type) {
        case "mouse dragstart":
          if (event.originButton !== 0) {
            return { status: "ignored" };
          }
          return startRegionDrag(editor, event.position, (nextAnchor) => {
            anchor = nextAnchor;
          });

        case "touch dragstart":
          if (!event.longPress) {
            return { status: "ignored" };
          }
          return startRegionDrag(editor, event.position, (nextAnchor) => {
            anchor = nextAnchor;
          });

        case "mouse dragmove":
        case "touch dragmove":
          return updateRegionDrag(editor, anchor, event.position);

        case "mouse dragend":
        case "touch dragend": {
          if (anchor === null) {
            return { status: "ignored" };
          }
          updateRegionDrag(editor, anchor, event.position);
          editor.actions.applyRegionDraftMarquee();
          anchor = null;
          editor.actions.setHoverPoint(event.position);
          return { status: "handled" };
        }

        case "mouse move":
          editor.actions.setHoverPoint(event.position);
          return { status: "handled", consume: false };

        default:
          return { status: "ignored" };
      }
    },
  };
}

function startRegionDrag(
  editor: EditorContract,
  position: GesturePosition,
  setAnchor: (anchor: GridPoint) => void,
): GestureHandleResult {
  const anchor = editor.queries.findGridCellForClientPixelPoint(position);
  if (anchor === null) {
    return { status: "ignored" };
  }

  setAnchor(anchor);
  editor.actions.clearHoverPoint();
  editor.actions.setRegionDraftMarquee(resolveGridRectFromPoints(anchor, anchor));
  return { status: "handled" };
}

function updateRegionDrag(
  editor: EditorContract,
  anchor: GridPoint | null,
  position: GesturePosition,
): GestureHandleResult {
  const currentPoint = editor.queries.findGridCellForClientPixelPoint(position);
  if (anchor === null || currentPoint === null) {
    return { status: "ignored" };
  }

  editor.actions.setRegionDraftMarquee(resolveGridRectFromPoints(anchor, currentPoint));
  return { status: "handled" };
}

function resolveGridRectFromPoints(start: GridPoint, end: GridPoint): GridRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    x: left,
    y: top,
    width: Math.max(start.x, end.x) - left + 1,
    height: Math.max(start.y, end.y) - top + 1,
  };
}
