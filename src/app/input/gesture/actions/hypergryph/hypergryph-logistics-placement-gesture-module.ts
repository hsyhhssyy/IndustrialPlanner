import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import {
  canCurrentBaseAcceptWulingOnlyEntities,
  canPlaceEntityDefinitionInCurrentBase,
} from "@/app/placement-zone-availability";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import type {
  CreateLogisticsDraftStartOptions,
  LogisticsDraftActionResult,
  LogisticsDraftEndpoint,
  LogisticsDraftReadonlyState,
  LogisticsKind,
  LogisticsRouteOrder,
} from "@/domain/shared/logistics";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { createLogger } from "@/shared/logging/logger";

import type { GestureHandleResult, GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";
import {
  closeCompactLeftDockOnPlacementEnter,
  resolveDeviceIdForPlacementGroupShortcut,
  resolveDeviceShortcutIndex,
  resolvePlacementGroupByShortcut,
  setPendingSinglePlacementEnter,
} from "./hypergryph-single-placement-gesture-module";

const LOGISTICS_TOOLBAR_BUTTON_IDS = [
  "canvas-floating-toolbar-button-cancel",
  "canvas-floating-toolbar-button-ok",
] as const;

const LOGISTICS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS = [
  "canvas-right-dock-toolbar-button-exit",
] as const;

const BELT_DRAW_BUTTON_ID = "placement-action-belt-draw";
const PIPE_DRAW_BUTTON_ID = "placement-action-pipe-draw";

const logisticsLogger = createLogger("logistics-placement");
// AI-REMOVED 2026-07-27:
// Reason: app 手势层不应维护 3 个传送带节 definition ID。
// Trigger: 用户要求 registry 外只使用 Query。
// Evidence: RegistryQuery.isBelt 精确表示传送带节。
// Replacement: shouldStopAfterApplyingToExistingBeltStart。
// Risk: Low
// Human Review: Required
//
// Original code:
// const ORDINARY_BELT_DEFINITION_IDS = new Set([
//   "belt_straight_1x1", "belt_turn_cw_1x1", "belt_turn_ccw_1x1",
// ]);
const GRID_EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];

interface LogisticsPlacementBehaviorOptions {
  readonly allowEmptySource: boolean;
  readonly autoCreateSplittersAndConvergers: boolean;
}

export function createHypergryphLogisticsPlacementGestureModule(): GestureMappingModule<AppHost> {
  let activeTouchLogisticsDragGestureId: string | null = null;

  return {
    id: "hypergryph-logistics-placement-gesture",
    when: isHypergryphGestureEnabled,
    handle(event, context) {
      if (event.type === "on-exit-active-tool") {
        if (event.from !== "logistics-placement" || event.to === "logistics-placement") {
          return { status: "ignored" };
        }

        activeTouchLogisticsDragGestureId = null;
        cleanupLogisticsPlacement(context.appHost);
        context.appHost.internalActions.hideCanvasTopLeftCornerToolbar();
        if (event.to === "select") {
          context.appHost.internalActions.setLeftDockSuppressed(false);
        }
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== "logistics-placement") {
          return { status: "ignored" };
        }

        closeCompactLeftDockOnPlacementEnter(context.appHost);
        syncLogisticsPlacementEntryUi(context.appHost);
        return { status: "handled" };
      }

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
          if (group === "pipeLogistics" && !canCurrentBaseAcceptWulingOnlyEntities(context.appHost)) {
            return { status: "ignored" };
          }

          if (editor === null) {
            return { status: "ignored" };
          }

          enterLogisticsPlacementMode({
            appHost: context.appHost,
            editor,
            kind: group === "beltLogistics"
              ? LOGISTICS_KIND.belt
              : LOGISTICS_KIND.pipe,
            pointerMode: "mouse",
          });
          return { status: "handled" };
        }
      }

      if (editor === null) {
        if (
          context.appHost.internalState.activeTool === "logistics-placement"
          && event.type === "mouse tap"
          && event.button === 0
        ) {
          const runtime = context.appHost.internalState.runtime.logisticsPlacement;
          logMouseLogisticsPlacementFailure(
            runtime.phase === "idle" ? "start" : "apply",
            "editor-unavailable",
            {
              kind: runtime.kind,
              longPress: event.longPress,
              position: event.position,
            },
          );
        }
        return { status: "ignored" };
      }

      if (event.type === "ui-button-mouse-tap" && event.button === 0) {
        const kind = resolveKindFromOperationButton(event.uiButtonId);
        if (kind !== null) {
          if (
            kind === LOGISTICS_KIND.pipe
            && !canCurrentBaseAcceptWulingOnlyEntities(context.appHost)
          ) {
            return { status: "ignored" };
          }

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
          if (
            kind === LOGISTICS_KIND.pipe
            && !canCurrentBaseAcceptWulingOnlyEntities(context.appHost)
          ) {
            return { status: "ignored" };
          }

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
          console.warn("[LOGISTICS-DEBUG]","touch-dragstart", {
            gestureId: event.gestureId,
            kind: context.appHost.internalState.runtime.logisticsPlacement.kind,
            allowEmptySource: resolveLogisticsPlacementBehaviorOptions(context.appHost).allowEmptySource,
            startPosition: event.startPosition,
            position: event.position,
          });
          const result = handleTouchDragStart({
            appHost: context.appHost,
            editor,
            position: event.position,
            startPosition: event.startPosition,
          });
          console.warn("[LOGISTICS-DEBUG]","touch-dragstart-result", {
            gestureId: event.gestureId,
            status: result.status,
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

        case "mouse move": {
          const runtime = context.appHost.internalState.runtime.logisticsPlacement;
          if (runtime.phase === "idle") {
            editor.actions.setHoverPoint(event.position);
          } else {
            editor.actions.clearHoverPoint();
          }
          return driveMouseLogisticsPreview({
            appHost: context.appHost,
            editor,
            position: event.position,
          });
        }

        case "mouse tap":
          if (event.button === 2) {
            const draftState = editor.queries.resolveLogisticsDraftState();
            if (draftState !== null) {
              cancelLogisticsPlacement(context.appHost, editor);
              return { status: "handled" };
            }

            exitLogisticsPlacementToSelect(context.appHost, editor);
            return { status: "handled" };
          }

          if (event.button !== 0) {
            return { status: "ignored" };
          }

          if (event.longPress) {
            const runtime = context.appHost.internalState.runtime.logisticsPlacement;
            logMouseLogisticsPlacementFailure(
              runtime.phase === "idle" || runtime.isHoverPreview ? "start" : "apply",
              "long-press-does-not-place-logistics",
              {
                kind: runtime.kind,
                position: event.position,
              },
            );
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
            return { status: "handled" };
          }

          if (event.uiButtonId === "canvas-right-dock-toolbar-button-exit") {
            exitLogisticsPlacementToSelect(context.appHost, editor);
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
  appHost.internalActions.hideCanvasRightDockToolbar();
}

function enterLogisticsPlacementMode(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  pointerMode: "mouse" | "touch";
}): void {
  const wasLogisticsPlacement = options.appHost.internalState.activeTool === "logistics-placement";
  if (wasLogisticsPlacement) {
    safelyCancelLogisticsDraft(options.editor);
  }

  resetLogisticsRuntime(options.appHost);
  const runtime = options.appHost.internalState.runtime.logisticsPlacement;
  runtime.kind = options.kind;
  runtime.shortcutPlacementGroup = options.kind === LOGISTICS_KIND.belt
    ? "beltLogistics"
    : "pipeLogistics";
  runtime.pointerMode = options.pointerMode;
  runtime.phase = "idle";
  runtime.routeOrder = "vertical-first";
  options.appHost.internalState.runtime.selectingPlacementGroup = runtime.shortcutPlacementGroup;
  options.appHost.workspace.editor?.actions.setLogisticsSuppression(
    options.kind === LOGISTICS_KIND.belt
      ? LOGISTICS_KIND.pipe
      : LOGISTICS_KIND.belt,
    true,
  );
  options.appHost.internalActions.showCanvasTopLeftCornerToolbar(
    options.kind === LOGISTICS_KIND.belt
      ? ["canvas-top-left-corner-toolbar-button-toggle-pipe-off"]
      : ["canvas-top-left-corner-toolbar-button-toggle-belt-off"],
  );
  options.appHost.internalActions.setActiveTool("logistics-placement");
  options.editor.actions.clearCollection(EntityCollectionType.selection);

  if (wasLogisticsPlacement) {
    syncLogisticsPlacementEntryUi(options.appHost);
  }
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
    allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
    source: resolveDevicePortStartSource(endpoint, gridPoint),
    routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
  });

  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "touch",
    phase: "drawing",
    result,
  });

  // 2026-05-23: 设备源创建 draft 后立即生成首个 freehand cell，
  // 保证 logisticsHead collection 非空，后续拖拽可正常继续。
  // AI-CORRECTION 2026-05-30: 首个 cell 应在端口外侧相邻格 (outsideGridPoint)，
  // 而非触摸点所在设备内部格，否则第一节管道出现在设备身上而非向外伸出。
  moveTouchLogisticsEnd({
    appHost: options.appHost,
    editor: options.editor,
    gridPoint: endpoint.outsideGridPoint,
  });

  // 2026-05-30: showTouchToolbar 必须在 moveTouchLogisticsEnd 填充 logisticsHead 之后调用，
  // 否则 alignCanvasFloatingToolbar 因 collection 为空而失败，导致工具条被隐藏。
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
  console.warn("[LOGISTICS-DEBUG]","handleTouchDragStart-enter", {
    kind, startGridPoint, pointerGridPoint,
    draftState: options.editor.queries.resolveLogisticsDraftState() !== null ? "present" : "null",
  });
  if (kind === null || startGridPoint === null || pointerGridPoint === null) {
    console.warn("[LOGISTICS-DEBUG]","handleTouchDragStart-null-early-return", { kind, startGridPoint, pointerGridPoint });
    return { status: "ignored" };
  }

  if (options.editor.queries.resolveLogisticsDraftState() !== null) {
    const onHead = isTouchDragStartOnLogisticsHead(options.editor, options.startPosition);
    console.warn("[LOGISTICS-DEBUG]","handleTouchDragStart-existing-draft", { onHead });
    if (!onHead) {
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
  console.warn("[LOGISTICS-DEBUG]","handleTouchDragStart-endpoint", {
    type: endpoint?.type ?? "null",
    portDirection: endpoint?.type === "device-port" ? endpoint.portDirection : "N/A",
  });
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
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
      source: resolveDevicePortStartSource(endpoint, pointerGridPoint),
      routeOrder: runtime.routeOrder,
    });
    updateRuntimeFromResult({
      appHost: options.appHost,
      pointerMode: "touch",
      phase: "drawing",
      result,
    });
    moveTouchLogisticsEnd({
      appHost: options.appHost,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    showTouchToolbar(options.appHost);
    return { status: "claimed" };
  }

  if (endpoint?.type === "logistics-entity") {
    const result = options.editor.actions.createLogisticsDraftStart({
      kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
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
    moveTouchLogisticsEnd({
      appHost: options.appHost,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    showTouchToolbar(options.appHost);
    return { status: "claimed" };
  }

  const startEntity = options.editor.queries.findEntityAtClientPixelPoint(options.startPosition);
  console.warn("[LOGISTICS-DEBUG]","handleTouchDragStart-startEntity", {
    hasEntity: startEntity !== null,
    allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
  });
  if (startEntity === null) {
    if (!resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource) {
      console.warn("[LOGISTICS-DEBUG]","handleTouchDragStart-empty-rejected");
      return { status: "ignored" };
    }

    const result = options.editor.actions.createLogisticsDraftStart({
      kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
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
    moveTouchLogisticsEnd({
      appHost: options.appHost,
      editor: options.editor,
      gridPoint: pointerGridPoint,
    });
    showTouchToolbar(options.appHost);
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

  // 2026-05-30: 记录是否在本帧从 waiting-touch-device-exit 转为 drawing，
  // 确保 showTouchToolbar 在 moveLogisticEnd 填充 logisticsHead 之后才调用。
  let didExitWaitingForDevice = false;

  if (runtime.phase === "waiting-touch-device-exit") {
    if (runtime.sourceEntityId === null || isGridPointInsideEntity(options, runtime.sourceEntityId, gridPoint)) {
      return { status: "handled" };
    }

    const startResult = options.editor.actions.createLogisticsDraftStart({
      kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
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
    didExitWaitingForDevice = true;
  }

  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: gridPoint,
    ...resolveMoveLogisticsDraftBehaviorOptions(options.appHost),
    routeMode: { type: "freehand" },
  });
  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "touch",
    phase: result.targetEntityId === null ? "drawing" : "snapped-target",
    result,
  });
  options.appHost.internalActions.alignCanvasFloatingToolbar();

  if (didExitWaitingForDevice) {
    showTouchToolbar(options.appHost);
  }

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
  if (kind === null || gridPoint === null) {
    return { status: "ignored" };
  }

  const draftState = options.editor.queries.resolveLogisticsDraftState();
  if (draftState === null || runtime.isHoverPreview) {
    return driveMouseLogisticsStartPreview({
      appHost: options.appHost,
      editor: options.editor,
      kind,
      gridPoint,
    });
  }

  if (
    runtime.lastPreviewGridPoint !== null
    && areGridPointsEqual(runtime.lastPreviewGridPoint, gridPoint)
  ) {
    return { status: "handled" };
  }

  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: gridPoint,
    ...resolveMoveLogisticsDraftBehaviorOptions(options.appHost),
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
  runtime.lastPreviewGridPoint = gridPoint;
  return { status: "handled" };
}

function driveMouseLogisticsStartPreview(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  kind: LogisticsKind;
  gridPoint: GridPoint;
}): GestureHandleResult {
  const runtime = options.appHost.internalState.runtime.logisticsPlacement;
  const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
    options.gridPoint,
    options.kind,
  );

  if (endpoint?.type !== "device-port" || endpoint.portDirection !== "output") {
    if (runtime.isHoverPreview) {
      options.editor.actions.cancelLogisticsDraft();
      softResetLogisticsRuntime(options.appHost);
    }
    runtime.lastPreviewGridPoint = options.gridPoint;
    return { status: "ignored" };
  }

  if (
    runtime.isHoverPreview
    && runtime.lastPreviewGridPoint !== null
    && areGridPointsEqual(runtime.lastPreviewGridPoint, options.gridPoint)
  ) {
    return { status: "handled" };
  }

  const result = options.editor.actions.createLogisticsDraftStart({
    kind: options.kind,
    allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
    source: resolveDevicePortStartSource(endpoint, options.gridPoint),
    routeOrder: runtime.routeOrder,
  });
  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
  runtime.phase = "idle";
  runtime.isHoverPreview = true;
  runtime.lastPreviewGridPoint = options.gridPoint;
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
  if (kind === null) {
    logMouseLogisticsPlacementFailure("start", "logistics-kind-missing", {
      kind,
      phase: runtime.phase,
      position: options.position,
    });
    return { status: "ignored" };
  }

  if (gridPoint === null) {
    logMouseLogisticsPlacementFailure(
      runtime.phase === "idle" || runtime.isHoverPreview ? "start" : "apply",
      "pointer-outside-editor-grid",
      {
        kind,
        phase: runtime.phase,
        position: options.position,
      },
    );
    return { status: "ignored" };
  }

  const draftState = options.editor.queries.resolveLogisticsDraftState();
  if (draftState === null) {
    runtime.isHoverPreview = false;
    return createMouseLogisticsStart({
      ...options,
      kind,
      gridPoint,
    });
  }

  if (runtime.isHoverPreview) {
    runtime.isHoverPreview = false;
    runtime.phase = "drawing";
    runtime.pointerMode = "mouse";
    runtime.lastPreviewGridPoint = gridPoint;
    return { status: "handled" };
  }

  const headGridPoint = runtime.headGridPoint;
  const targetEntityId = runtime.targetEntityId;
  const headDraftId = draftState?.headDraftEntityId ?? null;
  const headEntity = headDraftId !== null
    ? options.editor.queries.getEntityById(headDraftId)
    : null;
  const isHeadConverger = headEntity !== null
    && options.appHost.workspace.registry.queries.resolveLogisticsRole(headEntity.definitionId)
      === "converger";
  const shouldStopAtExistingBeltStart = shouldStopAfterApplyingToExistingBeltStart({
    appHost: options.appHost,
    editor: options.editor,
    draftState,
    headGridPoint,
    targetEntityId,
    kind,
  });

  if (!options.editor.actions.applyLogisticDraft()) {
    const rejectedDraftState =
      options.editor.queries.resolveLogisticsDraftState() ?? draftState;
    const invalidReason = rejectedDraftState.invalidReason;
    const previewEntityIds =
      options.editor.state.collections[EntityCollectionType.preview];
    const failureReason = invalidReason
      ?? (
        !rejectedDraftState.canApply
          ? "draft-not-applicable"
          : rejectedDraftState.cells.length === 0
            ? "empty-path"
            : previewEntityIds.length === 0
              ? "preview-collection-empty"
              : "editor-apply-rejected"
    );
    runtime.statusMessageKey = invalidReason ?? "unknown";
    logMouseLogisticsPlacementFailure("apply", failureReason, {
      kind,
      gridPoint,
      phase: runtime.phase,
      invalidReason,
      canApply: rejectedDraftState.canApply,
      cellCount: rejectedDraftState.cells.length,
      sourceType: rejectedDraftState.source?.type ?? null,
      targetType: rejectedDraftState.target?.type ?? null,
      headDraftEntityId: rejectedDraftState.headDraftEntityId,
      previewEntityCount: previewEntityIds.length,
    });
    return { status: "handled" };
  }

  // 自动创建汇流器后终止本次绘制，用户需重新选起点
  // AI-CORRECTION 2026-06-03: 连入无合法上游且有合法下游的已有传送带起点时也终止本段绘制。
  if (isHeadConverger || shouldStopAtExistingBeltStart) {
    softResetLogisticsRuntime(options.appHost);
    return { status: "handled" };
  }

  // 若终止于设备端口则回到准备起笔状态，不从入口前那一格继续
  if (headGridPoint !== null && targetEntityId === null) {
    createContinuedMouseLogisticsStart({
      appHost: options.appHost,
      editor: options.editor,
      kind,
      gridPoint: headGridPoint,
      entityId: headDraftId,
    });
  } else {
    softResetLogisticsRuntime(options.appHost);
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
  const behavior = resolveLogisticsPlacementBehaviorOptions(options.appHost);
  let result: LogisticsDraftActionResult | null = null;

  if (endpoint?.type === "device-port" && endpoint.portDirection === "output") {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: behavior.allowEmptySource,
      source: resolveDevicePortStartSource(endpoint, options.gridPoint),
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
  } else if (endpoint?.type === "logistics-entity") {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: behavior.allowEmptySource,
      source: {
        type: "logistics-entity",
        entityId: endpoint.entityId,
        gridPoint: endpoint.gridPoint,
      },
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
  } else if (options.pointerEntityId === null) {
    if (!behavior.allowEmptySource) {
      logMouseLogisticsPlacementFailure("start", "empty-source-disallowed", {
        kind: options.kind,
        gridPoint: options.gridPoint,
        pointerEntityId: options.pointerEntityId,
        endpointType: endpoint?.type ?? null,
      });
      return { status: "ignored" };
    }

    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: behavior.allowEmptySource,
      source: {
        type: "empty-cell",
        gridPoint: options.gridPoint,
      },
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
  }

  if (result === null) {
    const failureReason = endpoint?.type === "device-port"
      ? "source-port-is-not-output"
      : "clicked-entity-has-no-compatible-output";
    logMouseLogisticsPlacementFailure("start", failureReason, {
      kind: options.kind,
      gridPoint: options.gridPoint,
      pointerEntityId: options.pointerEntityId,
      endpointType: endpoint?.type ?? null,
      endpointPortDirection: endpoint?.type === "device-port" ? endpoint.portDirection : null,
    });
    return { status: "ignored" };
  }

  if (result.status === "ignored") {
    logMouseLogisticsPlacementFailure(
      "start",
      result.invalidReason ?? "draft-start-ignored",
      {
        kind: options.kind,
        gridPoint: options.gridPoint,
        pointerEntityId: options.pointerEntityId,
        endpointType: endpoint?.type ?? null,
        actionStatus: result.status,
        invalidReason: result.invalidReason,
        canApply: result.canApply,
      },
    );
  } else {
    logisticsLogger.debug("mouse-logistics-start OK", {
      kind: options.kind,
      gridPoint: options.gridPoint,
      endpointType: endpoint?.type ?? null,
      pointerEntityId: options.pointerEntityId,
    });
  }
  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
  options.appHost.internalState.runtime.logisticsPlacement.lastPreviewGridPoint = options.gridPoint;
  return { status: "handled" };
}

function logMouseLogisticsPlacementFailure(
  stage: "start" | "apply",
  reason: string,
  context: Readonly<Record<string, unknown>>,
): void {
  const failureType = stage === "start" ? "起笔失败" : "落笔失败";
  logisticsLogger.debug(`mouse-left-tap ${failureType}: ${reason}`, {
    ...context,
    failureStage: stage,
    failureType,
    failureReason: reason,
  });
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

  softResetLogisticsRuntime(appHost);
  appHost.internalActions.hideCanvasFloatingToolbar();
}

function moveTouchLogisticsEnd(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  gridPoint: GridPoint;
}): void {
  const result = options.editor.actions.moveLogisticEnd({
    pointerGridPoint: options.gridPoint,
    ...resolveMoveLogisticsDraftBehaviorOptions(options.appHost),
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
  entityId: string | null;
}): void {
  const continuedEntity = options.entityId === null
    ? null
    : options.editor.queries.getEntityById(options.entityId);
  const continuedEntityKind = continuedEntity === null
    ? null
    : options.appHost.workspace.registry.queries.resolveDedicatedLogisticsKind(
        continuedEntity.definitionId,
      );
  let result: LogisticsDraftActionResult;
  // AI-CORRECTION 2026-06-19:
  // 自动续画必须继承刚提交的普通物流末端，不能被同格相邻设备输出端口重新解释。
  if (
    continuedEntity !== null
    && continuedEntityKind === options.kind
  ) {
    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
      source: {
        type: "logistics-entity",
        entityId: continuedEntity.id,
        gridPoint: { ...continuedEntity.position },
      },
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
  } else {
    const endpoint = options.editor.queries.findLogisticsDraftEndpointAtGridPoint(
      options.gridPoint,
      options.kind,
    );
    if (endpoint?.type !== "device-port" || endpoint.portDirection !== "output") {
      // 2026-05-23: endpoint 非 logistics-entity 也非有效输出 device-port（如分流器/汇流器/桥接器
      // 已替代原普通物流段），不应从该格以 empty-cell 继续，否则会产生重叠管道。
      softResetLogisticsRuntime(options.appHost);
      return;
    }

    result = options.editor.actions.createLogisticsDraftStart({
      kind: options.kind,
      allowEmptySource: resolveLogisticsPlacementBehaviorOptions(options.appHost).allowEmptySource,
      source: resolveDevicePortStartSource(endpoint, options.gridPoint),
      routeOrder: options.appHost.internalState.runtime.logisticsPlacement.routeOrder,
    });
  }

  updateRuntimeFromResult({
    appHost: options.appHost,
    pointerMode: "mouse",
    phase: "drawing",
    result,
  });
  options.appHost.internalState.runtime.logisticsPlacement.lastPreviewGridPoint = options.gridPoint;
}

function cancelLogisticsPlacement(
  appHost: AppHost,
  editor: NonNullable<AppHost["workspace"]["editor"]>,
): void {
  editor.actions.cancelLogisticsDraft();
  softResetLogisticsRuntime(appHost);
  appHost.internalActions.hideCanvasFloatingToolbar();
}

function exitLogisticsPlacementToSelect(
  appHost: AppHost,
  editor: NonNullable<AppHost["workspace"]["editor"]> | null,
): void {
  if (editor !== null) {
    safelyCancelLogisticsDraft(editor);
  }

  resetLogisticsRuntime(appHost);
  appHost.internalActions.setActiveTool("select");
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
  if (
    gridPoint !== null
    && options.editor.queries.resolveLogisticsDraftState() !== null
    && !runtime.isHoverPreview
  ) {
    const result = options.editor.actions.moveLogisticEnd({
      pointerGridPoint: gridPoint,
      ...resolveMoveLogisticsDraftBehaviorOptions(options.appHost),
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

  if (group === "pipeLogistics" && !canCurrentBaseAcceptWulingOnlyEntities(options.appHost)) {
    return { status: "ignored" };
  }

  const deviceId = resolveDeviceIdForPlacementGroupShortcut({
    registry: options.appHost.workspace.registry,
    group,
    shortcutIndex,
    canUseDefinition: (definition) => canPlaceEntityDefinitionInCurrentBase(
      options.appHost,
      definition,
    ),
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

  // 2026-05-19 订正：不再手动创建 draft / 清理 logistics，改为写桥接变量 + setActiveTool。
  // logistics-placement 的 on-exit 自动清理 logistics draft，
  // single-placement 的 on-enter 读取桥接变量创建 placement draft。
  // 2026-06-23 订正：传入 logistics 追踪的鼠标位置作为 initialMousePosition，
  // 使 single-placement 的 on-enter 能正确判断鼠标是否在 viewport 内并立即创建 draft。
  setPendingSinglePlacementEnter({
    deviceId,
    anchor,
    pointerMode: "mouse",
    initialMousePosition: options.appHost.internalState.runtime.logisticsPlacement.lastMousePosition,
  });
  options.appHost.internalState.runtime.selectingPlacementGroup = group;
  options.appHost.internalActions.setActiveTool("single-placement");

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

function resolveLogisticsPlacementBehaviorOptions(appHost: AppHost): LogisticsPlacementBehaviorOptions {
  return {
    allowEmptySource: appHost.state.settings.hypergryphAllowEmptyLogisticsEndpoints,
    autoCreateSplittersAndConvergers:
      appHost.state.settings.hypergryphAutoCreateSplittersAndConvergers,
  };
}

function resolveDevicePortStartSource(
  endpoint: Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>,
  pointerGridPoint: GridPoint,
): CreateLogisticsDraftStartOptions["source"] {
  if (endpoint.fixedSource === true) {
    return {
      type: "fixed-device-port",
      entityId: endpoint.entityId,
      portGroupId: endpoint.portGroupId,
      portId: endpoint.portId,
      outsideGridPoint: { ...endpoint.outsideGridPoint },
    };
  }

  return {
    type: "device",
    entityId: endpoint.entityId,
    pointerGridPoint,
  };
}

function resolveMoveLogisticsDraftBehaviorOptions(appHost: AppHost): {
  readonly allowEmptyTarget: boolean;
  readonly autoCreateSplittersAndConvergers: boolean;
} {
  const behavior = resolveLogisticsPlacementBehaviorOptions(appHost);
  return {
    allowEmptyTarget: true,
    autoCreateSplittersAndConvergers: behavior.autoCreateSplittersAndConvergers,
  };
}

function showTouchToolbar(appHost: AppHost): void {
  appHost.internalActions.showCanvasFloatingToolbarForCollection(
    LOGISTICS_TOOLBAR_BUTTON_IDS,
    EntityCollectionType.logisticsHead,
  );
}

function syncLogisticsPlacementEntryUi(appHost: AppHost): void {
  appHost.internalActions.hideCanvasFloatingToolbar();
  appHost.internalActions.hideCanvasRightDockToolbar();

  if (appHost.internalState.runtime.logisticsPlacement.pointerMode !== "touch") {
    return;
  }

  appHost.internalActions.showCanvasRightDockToolbar(LOGISTICS_RIGHT_DOCK_TOOLBAR_BUTTON_IDS);
  if (appHost.internalState.workbench.rightDockOpen) {
    appHost.internalActions.toggleRightDock();
  }
}

function resetLogisticsRuntime(appHost: AppHost): void {
  const runtime = appHost.internalState.runtime.logisticsPlacement;
  appHost.workspace.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.belt, false);
  appHost.workspace.editor?.actions.setLogisticsSuppression(LOGISTICS_KIND.pipe, false);
  runtime.kind = null;
  runtime.shortcutPlacementGroup = null;
  runtime.pointerMode = null;
  runtime.phase = "idle";
  runtime.isHoverPreview = false;
  runtime.routeOrder = "vertical-first";
  runtime.sourceEntityId = null;
  runtime.targetEntityId = null;
  runtime.anchorGridPoint = null;
  runtime.headGridPoint = null;
  runtime.lastPreviewGridPoint = null;
  runtime.statusMessageKey = null;
}

function softResetLogisticsRuntime(appHost: AppHost): void {
  const runtime = appHost.internalState.runtime.logisticsPlacement;
  runtime.phase = "idle";
  runtime.isHoverPreview = false;
  runtime.sourceEntityId = null;
  runtime.targetEntityId = null;
  runtime.anchorGridPoint = null;
  runtime.headGridPoint = null;
  runtime.lastPreviewGridPoint = null;
  runtime.statusMessageKey = null;
}

function resolveKindFromOperationButton(uiButtonId: string): LogisticsKind | null {
  if (uiButtonId === BELT_DRAW_BUTTON_ID) {
    return LOGISTICS_KIND.belt;
  }
  if (uiButtonId === PIPE_DRAW_BUTTON_ID) {
    return LOGISTICS_KIND.pipe;
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

  return editor.queries.findGridCellForClientPixelPoint(position);
}

function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
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

  return editor.queries.findGridCellForClientPixelPoint({
    x: clientRect.left + clientRect.width / 2,
    y: clientRect.top + clientRect.height / 2,
  });
}

function shouldStopAfterApplyingToExistingBeltStart(options: {
  appHost: AppHost;
  editor: NonNullable<AppHost["workspace"]["editor"]>;
  draftState: LogisticsDraftReadonlyState;
  headGridPoint: GridPoint | null;
  targetEntityId: string | null;
  kind: LogisticsKind;
}): boolean {
  if (
    options.kind !== LOGISTICS_KIND.belt
    || options.headGridPoint === null
    || options.targetEntityId !== null
    || options.draftState.target !== null
    || !options.draftState.canApply
  ) {
    return false;
  }

  const document = options.editor.document.getSnapshot();
  const originalHeadEntity = findTopDocumentEntityAtGridPoint({
    appHost: options.appHost,
    document,
    gridPoint: options.headGridPoint,
  });
  if (
    originalHeadEntity === null
    || !options.appHost.workspace.registry.queries.isBelt(originalHeadEntity.definitionId)
    || !options.editor.state.collections[EntityCollectionType.ghost].includes(originalHeadEntity.id)
  ) {
    return false;
  }

  const connectionInfo = resolveOrdinaryBeltConnectionInfo({
    appHost: options.appHost,
    document,
    entity: originalHeadEntity,
  });

  return connectionInfo !== null
    && !connectionInfo.inputConnected
    && connectionInfo.outputConnected;
}

function resolveOrdinaryBeltConnectionInfo(options: {
  appHost: AppHost;
  document: WorldDocument;
  entity: WorldEntity;
}): {
  inputConnected: boolean;
  outputConnected: boolean;
} | null {
  const definition = resolveEntityDefinition(options.appHost, options.entity.definitionId);
  if (definition === null) {
    return null;
  }

  const inputEndpoint = resolveEntityPortEndpoints({
    entity: options.entity,
    definition,
    kind: LOGISTICS_KIND.belt,
    direction: "input",
  })[0];
  const outputEndpoint = resolveEntityPortEndpoints({
    entity: options.entity,
    definition,
    kind: LOGISTICS_KIND.belt,
    direction: "output",
  })[0];
  if (inputEndpoint === undefined || outputEndpoint === undefined) {
    return null;
  }

  return {
    inputConnected: doesNeighborOutputConnectToGridPoint({
      appHost: options.appHost,
      document: options.document,
      neighborGridPoint: inputEndpoint.outsideGridPoint,
      targetGridPoint: options.entity.position,
      ignoredEntityId: options.entity.id,
    }),
    outputConnected: doesGridPointOutputConnectToNeighborInput({
      appHost: options.appHost,
      document: options.document,
      sourceGridPoint: options.entity.position,
      neighborGridPoint: outputEndpoint.outsideGridPoint,
      ignoredEntityId: options.entity.id,
    }),
  };
}

function doesNeighborOutputConnectToGridPoint(options: {
  appHost: AppHost;
  document: WorldDocument;
  neighborGridPoint: GridPoint;
  targetGridPoint: GridPoint;
  ignoredEntityId: string;
}): boolean {
  const neighbor = findTopDocumentEntityAtGridPoint({
    appHost: options.appHost,
    document: options.document,
    gridPoint: options.neighborGridPoint,
  });
  if (neighbor === null || neighbor.id === options.ignoredEntityId) {
    return false;
  }

  const definition = resolveEntityDefinition(options.appHost, neighbor.definitionId);
  if (definition === null) {
    return false;
  }

  return resolveEntityPortEndpoints({
    entity: neighbor,
    definition,
    kind: LOGISTICS_KIND.belt,
    direction: "output",
  }).some((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.targetGridPoint));
}

function doesGridPointOutputConnectToNeighborInput(options: {
  appHost: AppHost;
  document: WorldDocument;
  sourceGridPoint: GridPoint;
  neighborGridPoint: GridPoint;
  ignoredEntityId: string;
}): boolean {
  const neighbor = findTopDocumentEntityAtGridPoint({
    appHost: options.appHost,
    document: options.document,
    gridPoint: options.neighborGridPoint,
  });
  if (neighbor === null || neighbor.id === options.ignoredEntityId) {
    return false;
  }

  const definition = resolveEntityDefinition(options.appHost, neighbor.definitionId);
  if (definition === null) {
    return false;
  }

  return resolveEntityPortEndpoints({
    entity: neighbor,
    definition,
    kind: LOGISTICS_KIND.belt,
    direction: "input",
  }).some((endpoint) => areGridPointsEqual(endpoint.outsideGridPoint, options.sourceGridPoint));
}

function findTopDocumentEntityAtGridPoint(options: {
  appHost: AppHost;
  document: WorldDocument;
  gridPoint: GridPoint;
}): WorldEntity | null {
  for (let index = options.document.entityOrder.length - 1; index >= 0; index -= 1) {
    const entityId = options.document.entityOrder[index];
    const entity = entityId === undefined ? undefined : options.document.entities[entityId];
    if (entity === undefined) {
      continue;
    }

    const definition = resolveEntityDefinition(options.appHost, entity.definitionId);
    if (definition === null) {
      continue;
    }

    if (
      isPointInsideEntityFootprint({
        gridPoint: options.gridPoint,
        entityPosition: entity.position,
        definition,
        rotation: entity.rotation,
      })
    ) {
      return entity;
    }
  }

  return null;
}

function resolveEntityPortEndpoints(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
  direction: "input" | "output";
}): Array<{
  outsideGridPoint: GridPoint;
}> {
  const isPipe = options.kind === LOGISTICS_KIND.pipe;
  const endpoints: Array<{ outsideGridPoint: GridPoint }> = [];

  for (const portGroup of options.definition.portGroups) {
    if (portGroup.isPipe !== isPipe || portGroup.direction !== options.direction) {
      continue;
    }

    for (const port of portGroup.ports) {
      const localCell = rotateLocalPortCell({
        footprint: options.definition.footprint,
        port,
        rotation: options.entity.rotation,
      });
      const edge = rotateGridEdge(port.edge, options.entity.rotation);
      const insideGridPoint = {
        x: options.entity.position.x + localCell.x,
        y: options.entity.position.y + localCell.y,
      };
      const delta = resolveEdgeDelta(edge);
      endpoints.push({
        outsideGridPoint: {
          x: insideGridPoint.x + delta.x,
          y: insideGridPoint.y + delta.y,
        },
      });
    }
  }

  return endpoints;
}

function rotateLocalPortCell(options: {
  footprint: EntityDefinition["footprint"];
  port: EntityDefinition["portGroups"][number]["ports"][number];
  rotation: GridRotation;
}): GridPoint {
  const { width, height } = options.footprint;
  const { localCellX: x, localCellY: y } = options.port;

  switch (options.rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - 1 - y, y: x };
    case 180:
      return { x: width - 1 - x, y: height - 1 - y };
    case 270:
      return { x: y, y: width - 1 - x };
  }
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const currentIndex = GRID_EDGE_ORDER.indexOf(edge);
  const steps = rotation / 90;
  return GRID_EDGE_ORDER[(currentIndex + steps) % GRID_EDGE_ORDER.length] ?? edge;
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH":
      return { x: 0, y: -1 };
    case "EAST":
      return { x: 1, y: 0 };
    case "SOUTH":
      return { x: 0, y: 1 };
    case "WEST":
      return { x: -1, y: 0 };
  }
}

function resolveEntityDefinition(appHost: AppHost, definitionId: string): EntityDefinition | null {
  return appHost.workspace.registry.entityDefinitions.find((definition) =>
    definition.id === definitionId,
  ) ?? null;
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
