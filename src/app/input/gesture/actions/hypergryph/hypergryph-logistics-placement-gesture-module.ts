import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { PlacementGroup } from "@/app/state/state-impl";
import { EntityCollectionType } from "@/domain/state/types";
import type { GridPoint } from "@/domain/types/grid";
import type {
  LogisticsDraftActionResult,
  LogisticsDraftEndpoint,
  LogisticsKind,
  LogisticsRouteOrder,
} from "@/domain/types/logistics";
import type { EntityDefinition } from "@/domain/types/registry/entity-definition";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { reaction } from "mobx";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import {
  resolveDeviceIdForPlacementGroupShortcut,
  resolveDeviceShortcutIndex,
  resolvePlacementGroupByShortcut,
} from "./hypergryph-single-placement-gesture-module";

const LOGISTICS_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-ok",
] as const;

const BELT_DRAW_BUTTON_ID = "placement-action-belt-draw";
const PIPE_DRAW_BUTTON_ID = "placement-action-pipe-draw";

export function createHypergryphLogisticsPlacementGestureModule(): GestureMappingModule<AppHost> {
  let activeTouchLogisticsDragGestureId: string | null = null;

  return {
    id: "hypergryph-logistics-placement-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      const editor = context.workspace.editor;

      if (event.type === "mouse move") {
        context.appHost.internalState.runtime.logisticsPlacement.lastMousePosition = event.position;
      }

      if (event.type === "key down") {
        const group = resolvePlacementGroupByShortcut({
          appHost: context.appHost,
          code: event.code,
          key: event.key,
          modifiers: event.modifiers,
        });

        if (group === "beltLogistics" || group === "pipeLogistics") {
          if (editor === null) {
            return { status: "ignored" };
          }

          enterLogisticsPlacementMode({
            appHost: context.appHost,
            editor,
            kind: group === "beltLogistics" ? "belt" : "pipe",
            pointerMode: "mouse",
          });
          return { status: "handled" };
        }
      }

      if (editor === null) {
        return { status: "ignored" };
      }

      if (event.type === "ui-button-mouse-tap" && event.button === 0) {
        const kind = resolveKindFromOperationButton(event.uiButtonId);
        if (kind !== null) {
          enterLogisticsPlacementMode({
            appHost: context.appHost,
            editor,
            kind,
            pointerMode: "mouse",
          });
          return { status: "handled" };
        }
      }

      if (event.type === "ui-button-touch-tap") {
        const kind = resolveKindFromOperationButton(event.uiButtonId);
        if (kind !== null) {
          enterLogisticsPlacementMode({
            appHost: context.appHost,
            editor,
            kind,
            pointerMode: "touch",
          });
          return { status: "handled" };
        }
      }

      if (context.appHost.internalState.activeTool !== "logistics-placement") {
        activeTouchLogisticsDragGestureId = null;
        return { status: "ignored" };
      }

      switch (event.type) {
        case "key down":
          if (handleRouteOrderShortcut({
            appHost: context.appHost,
            editor,
            code: event.code,
            key: event.key,
            modifiers: event.modifiers,
          })) {
            return { status: "handled" };
          }

          return handleLogisticsDeviceShortcut({
            appHost: context.appHost,
            editor,
            code: event.code,
            key: event.key,
            modifiers: event.modifiers,
          });

        case "touch tap":
          return handleTouchTap({
            appHost: context.appHost,
            editor,
            position: event.position,
            pointerEntityId: event.pointerEntity?.id ?? null,
          });

        case "touch dragstart": {
          const result = handleTouchDragStart({
            appHost: context.appHost,
            editor,
            position: event.position,
            startPosition: event.startPosition,
          });
          activeTouchLogisticsDragGestureId = result.status === "claimed" ? event.gestureId : null;
          return result;
        }

        case "touch dragmove":
          if (activeTouchLogisticsDragGestureId !== event.gestureId) {
            return { status: "ignored" };
          }

          return handleTouchDragMove({
            appHost: context.appHost,
            editor,
            position: event.position,
          });

        case "touch dragend": {
          if (activeTouchLogisticsDragGestureId !== event.gestureId) {
            return { status: "ignored" };
          }

          activeTouchLogisticsDragGestureId = null;
          return context.appHost.internalState.runtime.logisticsPlacement.phase === "idle"
            ? { status: "ignored" }
            : { status: "handled" };
        }

        case "mouse move":
          return driveMouseLogisticsPreview({
            appHost: context.appHost,
            editor,
            position: event.position,
          });

        case "mouse tap":
          if (event.button === 2) {
            cancelLogisticsPlacement(context.appHost, editor);
            context.appHost.internalActions.setActiveTool("select");
            return { status: "handled" };
          }

          if (event.button !== 0 || event.longPress) {
            return { status: "ignored" };
          }

          return handleMouseLeftTap({
            appHost: context.appHost,
            editor,
            position: event.position,
            pointerEntityId: event.pointerEntity?.id ?? null,
          });

        case "ui-button-touch-tap":
        case "ui-button-mouse-tap":
          if (event.type === "ui-button-mouse-tap" && event.button !== 0) {
            return { status: "ignored" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-ok") {
            applyTouchLogisticsPlacement(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-floating-toolbar-button-cancel") {
            cancelLogisticsPlacement(context.appHost, editor);
            context.appHost.internalActions.setActiveTool("select");
            return { status: "handled" };
          }

          return { status: "ignored" };

        default:
          return { status: "ignored" };
      }
    },
  };
}

export function cleanupLogisticsPlacement(appHost: AppHost): void {
  const editor = appHost.workspace.editor;
  if (editor !== null) {
    safelyCancelLogisticsDraft(editor);
  }

  resetLogisticsRuntime(appHost);
  appHost.internalActions.hideCanvasFloatingToolbar();
}

export function hookLogisticsPlacementToolCleanupFallback(appHost: AppHost): () => void {
  return reaction(
    () => appHost.internalState.activeTool,
    (activeTool, previousActiveTool) => {
      if (previousActiveTool === "logistics-placement" && activeTool !== "logistics-placement") {
        cleanupLogisticsPlacement(appHost);
      }
    },
  );
}

function enterLogisticsPlacementMode(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  pointerMode: "mouse" | "touch";
}): void {
  if (options.appHost.internalState.activeTool === "logistics-placement") {
    safelyCancelLogisticsDraft(options.editor);
  }

  resetLogisticsRuntime(options.appHost);
  const runtime = options.appHost.internalState.runtime.logisticsPlacement;
  runtime.kind = options.kind;
  runtime.shortcutPlacementGroup = options.kind === "belt" ? "beltLogistics" : "pipeLogistics";
  runtime.pointerMode = options.pointerMode;
  runtime.phase = "idle";
  runtime.routeOrder = "vertical-first";
  options.appHost.internalState.runtime.selectingPlacementGroup = runtime.shortcutPlacementGroup;
  options.appHost.internalActions.hideCanvasFloatingToolbar();
  options.appHost.internalActions.setActiveTool("logistics-placement");
}

function handleTouchTap(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
  pointerEntityId: string | null;
}): GestureHandleResult {
  const kind = options.appHost.internalState.runtime.logisticsPlacement.kind;
  const gridPoint = resolveGridPointFromGesturePosition(options.editor, options.position);
  if (kind === null || gridPoint === null || options.pointerEntityId === null) {
    return { status: "ignored" };
  }

  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(gridPoint, kind);
  if (endpoint?.type !== "device-port" || endpoint.portDirection !== "output") {
    return { status: "ignored" };
  }

  const result = options.editor.actions.createLogisticsDraftStart({
    kind,
    source: {
      type: "device",
      entityId: endpoint.entityId,
      pointerGridPoint: gridPoint,
    },
    routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
  });

  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "touch",
    phase: "drawing",
    result,
  });
  showTouchToolbar(options.appHost);
  return { status: "handled" };
}

function handleTouchDragStart(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
  startPosition: GesturePosition;
}): GestureHandleResult {
  const kind = options.appHost.internalState.runtime.logisticsPlacement.kind;
  const startGridPoint = resolveGridPointFromGesturePosition(options.editor, options.startPosition);
  const pointerGridPoint = resolveGridPointFromGesturePosition(options.editor, options.position);
  if (kind === null || startGridPoint === null || pointerGridPoint === null) {
    return { status: "ignored" };
  }

  if (options.editor.queries.resolveLogisticsDraftState() !== null) {
    if (!isTouchDragStartOnLogisticsHead(options.editor, options.startPosition)) {
      return { status: "ignored" };
    }

    options.appHost.internalState.runtime.logisticsPlacement.pointerMode = "touch";
    moveTouchLogisticsEnd({
      appHost: options.appHost,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    return { status: "claimed" };
  }

  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
    startGridPoint,
    kind,
  );
  if (endpoint?.type === "device-port" && endpoint.portDirection === "output") {
    const runtime = options.appHost.internalState.runtime.logisticsPlacement;
    runtime.pointerMode = "touch";
    runtime.phase = "waiting-touch-device-exit";
    runtime.sourceEntityId = endpoint.entityId;
    runtime.anchorGridPoint = startGridPoint;

    if (isGridPointInsideEntity(options, endpoint.entityId, pointerGridPoint)) {
      return { status: "claimed" };
    }

    const result = options.editor.actions.createLogisticsDraftStart({
      kind,
      source: {
        type: "device",
        entityId: endpoint.entityId,
        pointerGridPoint,
      },
      routeOrder: runtime.routeOrder,
    });
    updateRuntimeFromResult({
      appHost: options.appHost,
      pointerMode: "touch",
      phase: "drawing",
      result,
    });
    showTouchToolbar(options.appHost);
    moveTouchLogisticsEnd({
      appHost: options.appHost,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    return { status: "claimed" };
  }

  if (endpoint?.type === "logistics-entity") {
    const result = options.editor.actions.createLogisticsDraftStart({
      kind,
      source: {
        type: "logistics-entity",
        entityId: endpoint.entityId,
        gridPoint: endpoint.gridPoint,
      },
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
    updateRuntimeFromResult({
      appHost: options.appHost,
      pointerMode: "touch",
      phase: "drawing",
      result,
    });
    showTouchToolbar(options.appHost);
    moveTouchLogisticsEnd({
      appHost: options.appHost,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    return { status: "claimed" };
  }

  const startEntity = options.editor.queries.findEntityAtClientPixelPoint(options.startPosition);
  if (startEntity === null) {
    const result = options.editor.actions.createLogisticsDraftStart({
      kind,
      source: {
        type: "empty-cell",
        gridPoint: startGridPoint,
      },
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
    updateRuntimeFromResult({
      appHost: options.appHost,
      pointerMode: "touch",
      phase: "drawing",
      result,
    });
    showTouchToolbar(options.appHost);
    moveTouchLogisticsEnd({
      appHost: options.appHost,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    return { status: "claimed" };
  }

  return { status: "ignored" };
}

function handleTouchDragMove(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
}): GestureHandleResult {
  const runtime = options.appHost.internalState.runtime.logisticsPlacement;
  const kind = runtime.kind;
  const gridPoint = resolveGridPointFromGesturePosition(options.editor, options.position);
  if (kind === null || gridPoint === null) {
    return { status: "ignored" };
  }

  if (runtime.phase === "waiting-touch-device-exit") {
    if (runtime.sourceEntityId === null || isGridPointInsideEntity(options, runtime.sourceEntityId, gridPoint)) {
      return { status: "handled" };
    }

    const startResult = options.editor.actions.createLogisticsDraftStart({
      kind,
      source: {
        type: "device",
        entityId: runtime.sourceEntityId,
        pointerGridPoint: gridPoint,
      },
      routeOrder: runtime.routeOrder,
    });
    updateRuntimeFromResult({
      appHost: options.appHost,
      pointerMode: "touch",
      phase: "drawing",
      result: startResult,
    });
    showTouchToolbar(options.appHost);
  }

  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: gridPoint,
    routeMode: { type: "freehand" },
  });
  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "touch",
    phase: result.targetEntityId === null ? "drawing" : "snapped-target",
    result,
  });
  options.appHost.internalActions.alignCanvasFloatingToolbar();
  return { status: "handled" };
}

function driveMouseLogisticsPreview(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
}): GestureHandleResult {
  const runtime = options.appHost.internalState.runtime.logisticsPlacement;
  const kind = runtime.kind;
  const gridPoint = resolveGridPointFromGesturePosition(options.editor, options.position);
  if (kind === null || gridPoint === null || options.editor.queries.resolveLogisticsDraftState() === null) {
    return { status: "ignored" };
  }

  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: gridPoint,
    routeMode: {
      type: "single-bend",
      routeOrder: runtime.routeOrder,
      allowTemporaryOrderFlip: true,
    },
  });
  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "mouse",
    phase: result.targetEntityId === null ? "drawing" : "snapped-target",
    result,
  });
  return { status: "handled" };
}

function handleMouseLeftTap(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  position: GesturePosition;
  pointerEntityId: string | null;
}): GestureHandleResult {
  const runtime = options.appHost.internalState.runtime.logisticsPlacement;
  const kind = runtime.kind;
  const gridPoint = resolveGridPointFromGesturePosition(options.editor, options.position);
  if (kind === null || gridPoint === null) {
    return { status: "ignored" };
  }

  if (options.editor.queries.resolveLogisticsDraftState() === null) {
    return createMouseLogisticsStart({
      ...options,
      kind,
      gridPoint,
    });
  }

  const headGridPoint = runtime.headGridPoint;
  if (!options.editor.actions.applyLogisticDraft()) {
    runtime.statusMessageKey = options.editor.queries.resolveLogisticsDraftState()?.invalidReason ?? "unknown";
    return { status: "handled" };
  }

  if (headGridPoint !== null) {
    createContinuedMouseLogisticsStart({
      appHost: options.appHost,
      editor: options.editor,
      kind,
      gridPoint: headGridPoint,
    });
  }

  return { status: "handled" };
}

function createMouseLogisticsStart(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  gridPoint: GridPoint;
  pointerEntityId: string | null;
}): GestureHandleResult {
  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
    options.gridPoint,
    options.kind,
  );
  let result: LogisticsDraftActionResult | null = null;

  if (endpoint?.type === "device-port" && endpoint.portDirection === "output") {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      source: {
        type: "device",
        entityId: endpoint.entityId,
        pointerGridPoint: options.gridPoint,
      },
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
  } else if (endpoint?.type === "logistics-entity") {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      source: {
        type: "logistics-entity",
        entityId: endpoint.entityId,
        gridPoint: endpoint.gridPoint,
      },
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
  } else if (options.pointerEntityId === null) {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      source: {
        type: "empty-cell",
        gridPoint: options.gridPoint,
      },
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
  }

  if (result === null) {
    return { status: "ignored" };
  }

  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
  return { status: "handled" };
}

function applyTouchLogisticsPlacement(
  appHost: AppHost,
  editor: NonNullable<AppHost["workspace"]["editor"]>,
): void {
  const applied = editor.actions.applyLogisticDraft();
  if (!applied) {
    appHost.internalState.runtime.logisticsPlacement.statusMessageKey =
      editor.queries.resolveLogisticsDraftState()?.invalidReason ?? "unknown";
    return;
  }

  resetLogisticsRuntime(appHost);
  appHost.internalActions.hideCanvasFloatingToolbar();
  appHost.internalActions.setActiveTool("select");
}

function moveTouchLogisticsEnd(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  gridPoint: GridPoint;
}): void {
  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: options.gridPoint,
    routeMode: { type: "freehand" },
  });
  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "touch",
    phase: result.targetEntityId === null ? "drawing" : "snapped-target",
    result,
  });
  options.appHost.internalActions.alignCanvasFloatingToolbar();
}

function createContinuedMouseLogisticsStart(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  gridPoint: GridPoint;
}): void {
  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
    options.gridPoint,
    options.kind,
  );
  const result = endpoint?.type === "logistics-entity"
    ? options.editor.actions.createLogisticsDraftStart({
        kind: options.kind,
        source: {
          type: "logistics-entity",
          entityId: endpoint.entityId,
          gridPoint: endpoint.gridPoint,
        },
        routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
      })
    : options.editor.actions.createLogisticsDraftStart({
        kind: options.kind,
        source: {
          type: "empty-cell",
          gridPoint: options.gridPoint,
        },
        routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
      });

  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
}

function cancelLogisticsPlacement(
  appHost: AppHost,
  editor: NonNullable<AppHost["workspace"]["editor"]>,
): void {
  editor.actions.cancelLogisticsDraft();
  resetLogisticsRuntime(appHost);
  appHost.internalActions.hideCanvasFloatingToolbar();
}

function handleRouteOrderShortcut(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  code: string | null;
  key: string | null;
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean };
}): boolean {
  if (options.modifiers.alt || options.modifiers.ctrl || options.modifiers.meta) {
    return false;
  }

  const isRouteShortcut = options.code === "KeyR" || options.key?.trim().toLowerCase() === "r";
  if (!isRouteShortcut) {
    return false;
  }

  const runtime = options.appHost.internalState.runtime.logisticsPlacement;
  runtime.routeOrder = flipRouteOrder(runtime.routeOrder);

  const gridPoint = resolveGridPointFromGesturePosition(options.editor, runtime.lastMousePosition);
  if (gridPoint !== null && options.editor.queries.resolveLogisticsDraftState() !== null) {
    const result = options.editor.actions.moveLogisticEnd({
      pointerGridPoint: gridPoint,
      routeMode: {
        type: "single-bend",
        routeOrder: runtime.routeOrder,
        allowTemporaryOrderFlip: true,
      },
    });
    updateRuntimeFromResult({
      appHost: options.appHost,
      pointerMode: "mouse",
      phase: result.targetEntityId === null ? "drawing" : "snapped-target",
      result,
    });
  }

  return true;
}

function handleLogisticsDeviceShortcut(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  code: string | null;
  key: string | null;
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
}): GestureHandleResult {
  const shortcutIndex = resolveDeviceShortcutIndex(options);
  if (shortcutIndex === null) {
    return { status: "ignored" };
  }

  const group = options.appHost.internalState.runtime.logisticsPlacement.shortcutPlacementGroup;
  if (group === null) {
    return { status: "ignored" };
  }

  const deviceId = resolveDeviceIdForPlacementGroupShortcut({
    registry: options.appHost.workspace.registry,
    group,
    shortcutIndex,
  });
  if (deviceId === null) {
    return { status: "ignored" };
  }

  const anchor = resolveGridPointFromGesturePosition(
    options.editor,
    options.appHost.internalState.runtime.logisticsPlacement.lastMousePosition,
  ) ?? resolveViewportCenterGridPoint(options.editor);
  if (anchor === null) {
    return { status: "ignored" };
  }

  options.editor.actions.cancelLogisticsDraft();
  resetLogisticsRuntime(options.appHost);
  options.appHost.internalActions.hideCanvasFloatingToolbar();
  options.appHost.internalActions.setActiveTool("single-placement");
  options.appHost.internalState.runtime.selectingPlacementGroup = group;
  options.appHost.internalState.runtime.placementAnchor = anchor;

  try {
    options.editor.actions.createSinglePlacementDraft(deviceId, anchor);
    options.appHost.internalState.runtime.singlePlacementDeviceId = deviceId;
  } catch {
    options.appHost.internalState.runtime.placementAnchor = null;
    options.appHost.internalState.runtime.singlePlacementDeviceId = null;
    options.appHost.internalActions.setActiveTool("select");
    return { status: "ignored" };
  }

  return { status: "handled" };
}

function updateRuntimeFromResult(options: {
  appHost: AppHost;
  pointerMode: "mouse" | "touch";
  phase: "drawing" | "snapped-target";
  result: LogisticsDraftActionResult;
}): void {
  const runtime = options.appHost.internalState.runtime.logisticsPlacement;
  runtime.pointerMode = options.pointerMode;
  runtime.phase = options.phase;
  runtime.sourceEntityId = options.result.sourceEntityId;
  runtime.targetEntityId = options.result.targetEntityId;
  runtime.headGridPoint = options.result.headGridPoint;
  runtime.statusMessageKey = options.result.invalidReason;

  if (options.result.status === "created") {
    runtime.anchorGridPoint = options.result.headGridPoint;
  } else if (runtime.anchorGridPoint === null && options.result.headGridPoint !== null) {
    runtime.anchorGridPoint = options.result.headGridPoint;
  }
}

function showTouchToolbar(appHost: AppHost): void {
  appHost.internalActions.showCanvasFloatingToolbarForCollection(
    LOGISTICS_TOOLBAR_BUTTON_IDS,
    EntityCollectionType.logisticsHead,
  );
}

function resetLogisticsRuntime(appHost: AppHost): void {
  const runtime = appHost.internalState.runtime.logisticsPlacement;
  runtime.kind = null;
  runtime.shortcutPlacementGroup = null;
  runtime.pointerMode = null;
  runtime.phase = "idle";
  runtime.routeOrder = "vertical-first";
  runtime.sourceEntityId = null;
  runtime.targetEntityId = null;
  runtime.anchorGridPoint = null;
  runtime.headGridPoint = null;
  runtime.statusMessageKey = null;
}

function resolveKindFromOperationButton(uiButtonId: string): LogisticsKind | null {
  if (uiButtonId === BELT_DRAW_BUTTON_ID) {
    return "belt";
  }
  if (uiButtonId === PIPE_DRAW_BUTTON_ID) {
    return "pipe";
  }

  return null;
}

function safelyCancelLogisticsDraft(editor: NonNullable<AppHost["workspace"]["editor"]>): void {
  try {
    editor.actions.cancelLogisticsDraft();
  } catch {
    // Best-effort cleanup is intentionally silent; logistics placement should not leave stale preview state.
  }
}

function resolveGridPointFromGesturePosition(
  editor: NonNullable<AppHost["workspace"]["editor"]>,
  position: GesturePosition | null,
): GridPoint | null {
  if (position === null) {
    return null;
  }

  return editor.queries.findGridCellForClientPixlePoint(position);
}

function isTouchDragStartOnLogisticsHead(
  editor: NonNullable<AppHost["workspace"]["editor"]>,
  startPosition: GesturePosition,
): boolean {
  const startEntity = editor.queries.findEntityAtClientPixelPoint(startPosition);
  return (
    startEntity !== null
    && editor.state.collections[EntityCollectionType.logisticsHead].contains(startEntity.id)
  );
}

function resolveViewportCenterGridPoint(
  editor: NonNullable<AppHost["workspace"]["editor"]>,
): GridPoint | null {
  const clientRect = editor.state.viewport.clientRect;

  return editor.queries.findGridCellForClientPixlePoint({
    x: clientRect.left + clientRect.width / 2,
    y: clientRect.top + clientRect.height / 2,
  });
}

function isGridPointInsideEntity(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
}, entityId: string, gridPoint: GridPoint): boolean {
  const entity = options.editor.queries.getEntityById(entityId);
  if (entity === null) {
    return false;
  }

  const definition = options.appHost.workspace.registry.entityDefinitions.find(
    (candidate) => candidate.id === entity.definitionId,
  );
  if (definition === undefined) {
    return false;
  }

  return isPointInsideEntityFootprint({
    gridPoint,
    entityPosition: entity.position,
    definition,
    rotation: entity.rotation,
  });
}

function isPointInsideEntityFootprint(options: {
  gridPoint: GridPoint;
  entityPosition: GridPoint;
  definition: EntityDefinition;
  rotation: 0 | 90 | 180 | 270;
}): boolean {
  const footprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.rotation,
  );

  return (
    options.gridPoint.x >= options.entityPosition.x
    && options.gridPoint.x < options.entityPosition.x + footprint.width
    && options.gridPoint.y >= options.entityPosition.y
    && options.gridPoint.y < options.entityPosition.y + footprint.height
  );
}

function flipRouteOrder(routeOrder: LogisticsRouteOrder): LogisticsRouteOrder {
  return routeOrder === "vertical-first" ? "horizontal-first" : "vertical-first";
}
