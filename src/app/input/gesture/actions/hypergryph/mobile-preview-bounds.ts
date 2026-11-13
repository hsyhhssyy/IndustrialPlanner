import type { CanvasInteractionController } from "@/app/canvas";
import type { EditorViewContract } from "@/domain/editor/editor-view-contract";
// AI-REMOVED 2026-11-12:
// Reason: 统一场景迁移后旧对象没有有效调用。
// Trigger: REQ-048 P6 与 ESLint unused 审计。
// Evidence: 当前调用由 Canvas 或 SceneViewInput 提供，原引用仅存于审计注释。
// Replacement: CanvasActionImpl / SceneViewInput / 通用只读场景
// Risk: Low
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { EditorContract } from "@/domain/editor/editor-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import {
  resolveViewportRectFromWorldGridRect,
  resolveWorldVectorFromViewportVector,
} from "@/shared/geometry/viewport-transform";

export const MOBILE_PREVIEW_SAFE_INSET_CELLS = {
  x: 1,
  y: 1,
};

export const TOUCH_PREVIEW_HIT_SLOP_PX = 16;

const GRID_VECTOR_EPSILON = 1e-6;

export function isPreviewBoundingBoxAtClientPoint(options: {
  editor: EditorContract;
  view: EditorViewContract;
  position: GesturePosition;
  hitSlopPx?: number;
}): boolean {
  const gridCell = options.view.queries.findGridCellForClientPixelPoint(
    options.position,
  );
  const previewRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );

  const isStrictHit = (
    gridCell !== null
    && previewRect !== null
    && gridCell.x >= previewRect.x
    && gridCell.x < previewRect.x + previewRect.width
    && gridCell.y >= previewRect.y
    && gridCell.y < previewRect.y + previewRect.height
  );

  if (isStrictHit) {
    return true;
  }

  const hitSlopPx = options.hitSlopPx ?? 0;
  if (previewRect === null || !Number.isFinite(hitSlopPx) || hitSlopPx <= 0) {
    return false;
  }

  const viewport = options.view.state;
  const previewClientRect = resolveViewportRectFromWorldGridRect({
    gridRect: previewRect,
    viewportBounds: viewport.clientRect,
    viewportCenter: viewport.center,
    gridCellPixelSize: viewport.gridCellPixelSize,
    displayRotation: viewport.displayRotation,
  });

  return previewClientRect !== null && isClientPointWithinHitSlop({
    position: options.position,
    clientRect: previewClientRect,
    hitSlopPx,
  });
}

function isClientPointWithinHitSlop(options: {
  position: GesturePosition;
  clientRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  hitSlopPx: number;
}): boolean {
  const right = options.clientRect.left + options.clientRect.width;
  const bottom = options.clientRect.top + options.clientRect.height;
  const nearestX = Math.min(Math.max(options.position.x, options.clientRect.left), right);
  const nearestY = Math.min(Math.max(options.position.y, options.clientRect.top), bottom);

  return Math.hypot(options.position.x - nearestX, options.position.y - nearestY)
    <= options.hitSlopPx;
}

export function resolveTouchDragAnchorAfterPreviewMove(options: {
  beforeRect: GridRect;
  afterRect: GridRect;
  startGridPoint: GridPoint;
  endGridPoint: GridPoint;
}): GridPoint {
  const vector = {
    x: options.endGridPoint.x - options.startGridPoint.x,
    y: options.endGridPoint.y - options.startGridPoint.y,
  };

  return {
    x: options.afterRect.x === options.beforeRect.x + vector.x
      && options.afterRect.width === options.beforeRect.width
      ? options.endGridPoint.x
      : options.startGridPoint.x,
    y: options.afterRect.y === options.beforeRect.y + vector.y
      && options.afterRect.height === options.beforeRect.height
      ? options.endGridPoint.y
      : options.startGridPoint.y,
  };
}

export function didPreviewRectChange(
  beforeRect: GridRect,
  afterRect: GridRect,
): boolean {
  return (
    beforeRect.x !== afterRect.x
    || beforeRect.y !== afterRect.y
    || beforeRect.width !== afterRect.width
    || beforeRect.height !== afterRect.height
  );
}

export function hasSingleOuterRingEdgeSnapPreview(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
}): boolean {
  const preview = options.editor.state.collections[EntityCollectionType.preview];
  if (preview.length !== 1) {
    return false;
  }

  const entityId = preview[0];
  if (entityId === undefined) {
    return false;
  }

  const entity = options.editor.queries.getEntityById(entityId);
  if (entity === null) {
    return false;
  }

  const definition = options.canvas.registry.entityDefinitions.find((candidate) =>
    candidate.id === entity.definitionId,
  );

  return definition?.placementBehaviors.some((behavior) =>
    behavior.type === PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge,
  ) ?? false;
}

export function nudgeMobilePreviewIntoSafeViewport(options: {
  canvas: CanvasInteractionController;
  editor: EditorContract;
}): boolean {
  if (!shouldNudgePreviewForCurrentMobileTool(options.canvas)) {
    return false;
  }

  const previewGridRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (previewGridRect === null) {
    return false;
  }

  const viewport = options.canvas.view.state;
  const safeViewportRect = resolveSafeViewportClientRect({
    clientRect: viewport.clientRect,
    gridCellPixelSize: viewport.gridCellPixelSize,
  });
  if (safeViewportRect === null) {
    return false;
  }

  const previewViewportRect = resolveViewportRectFromWorldGridRect({
    gridRect: previewGridRect,
    viewportBounds: viewport.clientRect,
    viewportCenter: viewport.center,
    gridCellPixelSize: viewport.gridCellPixelSize,
    displayRotation: viewport.displayRotation,
  });
  if (previewViewportRect === null) {
    return false;
  }

  const viewportPixelVector = resolvePreviewNudgeViewportPixelVector({
    previewViewportRect,
    safeViewportRect,
    gridCellPixelSize: viewport.gridCellPixelSize,
  });
  if (viewportPixelVector.x === 0 && viewportPixelVector.y === 0) {
    return false;
  }

  const gridVector = resolveGridVectorFromViewportPixelVector({
    viewportPixelVector,
    gridCellPixelSize: viewport.gridCellPixelSize,
    displayRotation: viewport.displayRotation,
  });
  if (gridVector.x === 0 && gridVector.y === 0) {
    return false;
  }

  options.editor.actions.moveCollectionTo({
    collectionType: EntityCollectionType.preview,
    startGridPoint: {
      x: previewGridRect.x,
      y: previewGridRect.y,
    },
    endGridPoint: {
      x: previewGridRect.x + gridVector.x,
      y: previewGridRect.y + gridVector.y,
    },
  });
  const afterRect = options.editor.queries.findEntityCollectionGridRect(
    EntityCollectionType.preview,
  );
  if (afterRect !== null) {
    nudgeRuntimeAnchor(options.canvas, {
      beforeRect: previewGridRect,
      afterRect,
      startGridPoint: {
        x: previewGridRect.x,
        y: previewGridRect.y,
      },
      endGridPoint: {
        x: previewGridRect.x + gridVector.x,
        y: previewGridRect.y + gridVector.y,
      },
    });
  }
  return true;
}

function shouldNudgePreviewForCurrentMobileTool(canvas: CanvasInteractionController): boolean {
  const deviceClass = canvas.workbench.state.screenProfile?.deviceClass;
  if (deviceClass !== "mobile" && deviceClass !== "tablet") {
    return false;
  }

  const activeTool = canvas.state.activeTool;
  return (
    activeTool === "single-placement"
    || activeTool === "blueprint-placement"
    || activeTool === "move"
  );
}

function resolveSafeViewportClientRect(options: {
  clientRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  gridCellPixelSize: number;
}): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (
    !Number.isFinite(options.clientRect.left)
    || !Number.isFinite(options.clientRect.top)
    || !Number.isFinite(options.clientRect.width)
    || !Number.isFinite(options.clientRect.height)
    || !Number.isFinite(options.gridCellPixelSize)
    || options.clientRect.width <= 0
    || options.clientRect.height <= 0
    || options.gridCellPixelSize <= 0
  ) {
    return null;
  }

  const horizontal = resolveSafeViewportAxis({
    start: options.clientRect.left,
    span: options.clientRect.width,
    rawInset: MOBILE_PREVIEW_SAFE_INSET_CELLS.x * options.gridCellPixelSize,
    gridCellPixelSize: options.gridCellPixelSize,
  });
  const vertical = resolveSafeViewportAxis({
    start: options.clientRect.top,
    span: options.clientRect.height,
    rawInset: MOBILE_PREVIEW_SAFE_INSET_CELLS.y * options.gridCellPixelSize,
    gridCellPixelSize: options.gridCellPixelSize,
  });

  return {
    left: horizontal.start,
    top: vertical.start,
    width: horizontal.end - horizontal.start,
    height: vertical.end - vertical.start,
  };
}

function resolveSafeViewportAxis(options: {
  start: number;
  span: number;
  rawInset: number;
  gridCellPixelSize: number;
}): {
  start: number;
  end: number;
} {
  const requiredVisibleSpan = Math.min(options.gridCellPixelSize, options.span);
  const maxInset = Math.max(0, (options.span - requiredVisibleSpan) / 2);
  const inset = Math.min(Math.max(0, options.rawInset), maxInset);

  return {
    start: options.start + inset,
    end: options.start + options.span - inset,
  };
}

function resolvePreviewNudgeViewportPixelVector(options: {
  previewViewportRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  safeViewportRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  gridCellPixelSize: number;
}): GridPoint {
  return {
    x: resolvePreviewNudgeAxisPixelVector({
      previewStart: options.previewViewportRect.left,
      previewSpan: options.previewViewportRect.width,
      safeStart: options.safeViewportRect.left,
      safeSpan: options.safeViewportRect.width,
      gridCellPixelSize: options.gridCellPixelSize,
    }),
    y: resolvePreviewNudgeAxisPixelVector({
      previewStart: options.previewViewportRect.top,
      previewSpan: options.previewViewportRect.height,
      safeStart: options.safeViewportRect.top,
      safeSpan: options.safeViewportRect.height,
      gridCellPixelSize: options.gridCellPixelSize,
    }),
  };
}

function resolvePreviewNudgeAxisPixelVector(options: {
  previewStart: number;
  previewSpan: number;
  safeStart: number;
  safeSpan: number;
  gridCellPixelSize: number;
}): number {
  const previewEnd = options.previewStart + options.previewSpan;
  const safeEnd = options.safeStart + options.safeSpan;
  const requiredVisibleSpan = Math.min(
    options.gridCellPixelSize,
    options.previewSpan,
    options.safeSpan,
  );

  if (requiredVisibleSpan <= 0) {
    return 0;
  }

  if (previewEnd < options.safeStart + requiredVisibleSpan) {
    return options.safeStart + requiredVisibleSpan - previewEnd;
  }

  if (options.previewStart > safeEnd - requiredVisibleSpan) {
    return safeEnd - requiredVisibleSpan - options.previewStart;
  }

  return 0;
}

function resolveGridVectorFromViewportPixelVector(options: {
  viewportPixelVector: GridPoint;
  gridCellPixelSize: number;
  displayRotation: EditorViewContract["state"]["displayRotation"];
}): GridPoint {
  const worldVector = resolveWorldVectorFromViewportVector({
    viewportVector: options.viewportPixelVector,
    displayRotation: options.displayRotation,
  });

  return {
    x: roundGridVectorAwayFromZero(worldVector.x / options.gridCellPixelSize),
    y: roundGridVectorAwayFromZero(worldVector.y / options.gridCellPixelSize),
  };
}

function roundGridVectorAwayFromZero(value: number): number {
  const nearestInteger = Math.round(value);
  if (Math.abs(value - nearestInteger) <= GRID_VECTOR_EPSILON) {
    return nearestInteger;
  }

  return value > 0 ? Math.ceil(value) : Math.floor(value);
}

function nudgeRuntimeAnchor(canvas: CanvasInteractionController, options: {
  beforeRect: GridRect;
  afterRect: GridRect;
  startGridPoint: GridPoint;
  endGridPoint: GridPoint;
}): void {
  const runtime = canvas.state.runtime;

  if (
    canvas.state.activeTool === "single-placement"
    || canvas.state.activeTool === "blueprint-placement"
  ) {
    const anchor = runtime.placementAnchor;
    if (anchor !== null) {
      runtime.placementAnchor = resolveTouchDragAnchorAfterPreviewMove({
        ...options,
        startGridPoint: anchor,
        endGridPoint: {
          x: anchor.x + options.endGridPoint.x - options.startGridPoint.x,
          y: anchor.y + options.endGridPoint.y - options.startGridPoint.y,
        },
      });
    }
    return;
  }

  if (canvas.state.activeTool === "move") {
    const anchor = runtime.moveAnchor;
    if (anchor !== null) {
      runtime.moveAnchor = resolveTouchDragAnchorAfterPreviewMove({
        ...options,
        startGridPoint: anchor,
        endGridPoint: {
          x: anchor.x + options.endGridPoint.x - options.startGridPoint.x,
          y: anchor.y + options.endGridPoint.y - options.startGridPoint.y,
        },
      });
    }
  }
}
