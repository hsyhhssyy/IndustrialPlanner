import { action } from "mobx";
import type { CanvasInteractionController } from "../canvas";
import type { AppInternalAction } from "./action-impl";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import { CANVAS_OPERATION_IDS, type CanvasOperationId } from "@/domain/shared/canvas-operation";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";
import { CANVAS_FLOATING_TOOLBAR_BUTTON_IDS, CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS, type CanvasInteractionStateReadWriteImpl, type CanvasFloatingToolbarButtonId, type CanvasFloatingToolbarSize, type CanvasRightDockToolbarItemRequest, type CanvasRightDockToolbarPresentation, type CanvasTopLeftCornerToolbarButtonId, type CanvasTopLeftCornerToolbarShowButtonId } from "../state";

type CanvasInternalAction = Pick<AppInternalAction, "showCanvasToast" | "setCanvasAlert" | "setActiveTool" | "showCanvasFloatingToolbar" | "showCanvasFloatingToolbarForCollection" | "moveCanvasFloatingToolbar" | "alignCanvasFloatingToolbar" | "setCanvasFloatingToolbarSize" | "hideCanvasFloatingToolbar" | "showCanvasRightDockToolbar" | "hideCanvasRightDockToolbar" | "showCanvasTopLeftCornerToolbar" | "hideCanvasTopLeftCornerToolbar">;
const DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT = 44;
const FLOATING_TOOLBAR_DEVICE_GAP_PX = 6;

export class CanvasActionImpl implements CanvasInternalAction {
constructor(private readonly state: CanvasInteractionStateReadWriteImpl, private readonly canvas: CanvasInteractionController) {}
private canvasToastTimer: ReturnType<typeof setTimeout> | null = null;

private canvasToastRevision = 0;

private disposed = false;

public readonly showCanvasToast: CanvasInternalAction["showCanvasToast"] = action((messageKey) => {
    if (this.disposed) return;
    if (this.canvasToastTimer !== null) clearTimeout(this.canvasToastTimer);
    const revision = ++this.canvasToastRevision;
    this.state.runtime.canvasToastKey = messageKey;
    this.canvasToastTimer = setTimeout(action(() => {
      if (this.disposed || revision !== this.canvasToastRevision) return;
      this.state.runtime.canvasToastKey = null;
      this.canvasToastTimer = null;
    }), 3000);
  });

public readonly setCanvasAlert: CanvasInternalAction["setCanvasAlert"] = action((messageKey) => {
    if (!this.disposed) this.state.runtime.canvasAlertKey = messageKey;
  });

public readonly dispose = action(() => {
    this.disposed = true;
    ++this.canvasToastRevision;
    if (this.canvasToastTimer !== null) clearTimeout(this.canvasToastTimer);
    this.canvasToastTimer = null;
    this.state.runtime.canvasToastKey = null;
    this.state.runtime.canvasAlertKey = null;
  });

public readonly setActiveTool: CanvasInternalAction["setActiveTool"] = action((activeTool) => {
    if (activeTool === "select") this.canvas.setPlacementPanelSuppressed(false);
    const previousActiveTool = this.state.activeTool;
    if (previousActiveTool === activeTool) {
      return;
    }
    this.canvas.cancelPendingPlacementPreparation();

    if (!(previousActiveTool === "select" && activeTool === "single-placement")) {
      this.state.runtime.selectingPlacementGroup = null;
    }

    if (activeTool !== "dark-pipe-link") {
      this.state.toolInfo.darkPipeLink = null;
    }

    this.state.activeTool = activeTool;
  });

public readonly showCanvasFloatingToolbar: CanvasInternalAction["showCanvasFloatingToolbar"] = action((
    buttonIds,
    clientPixelPoint,
  ) => {
    const nextButtonIds = normalizeCanvasFloatingToolbarButtonIds(buttonIds).filter(id => this.canvas.getFloatingButtonAvailability(id).supported);
    const nextAnchor = normalizeClientPixelPoint(clientPixelPoint);

    if (nextButtonIds.length === 0 || nextAnchor === null) {
      this.hideCanvasFloatingToolbar();
      return;
    }

    this.state.runtime.canvasFloatingToolbar.visible = true;
    this.state.runtime.canvasFloatingToolbar.buttonIds = nextButtonIds;
    this.state.runtime.canvasFloatingToolbar.anchor = nextAnchor;
    this.state.runtime.canvasFloatingToolbar.attachedCollection = null;
  });

public readonly showCanvasFloatingToolbarForCollection: CanvasInternalAction["showCanvasFloatingToolbarForCollection"] = action((
    buttonIds,
    collectionType,
  ) => {
    const nextButtonIds = normalizeCanvasFloatingToolbarButtonIds(buttonIds).filter(id => this.canvas.getFloatingButtonAvailability(id).supported);

    if (nextButtonIds.length === 0) {
      this.hideCanvasFloatingToolbar();
      return false;
    }

    this.state.runtime.canvasFloatingToolbar.visible = true;
    this.state.runtime.canvasFloatingToolbar.buttonIds = nextButtonIds;
    this.state.runtime.canvasFloatingToolbar.attachedCollection = collectionType;

    if (!this.alignCanvasFloatingToolbar()) {
      this.hideCanvasFloatingToolbar();
      return false;
    }

    return true;
  });

public readonly moveCanvasFloatingToolbar: CanvasInternalAction["moveCanvasFloatingToolbar"] = action((
    clientPixelPoint,
  ) => {
    if (!this.state.runtime.canvasFloatingToolbar.visible) {
      return;
    }

    const nextAnchor = normalizeClientPixelPoint(clientPixelPoint);
    if (nextAnchor === null) {
      return;
    }

    this.state.runtime.canvasFloatingToolbar.anchor = nextAnchor;
  });

public readonly alignCanvasFloatingToolbar: CanvasInternalAction["alignCanvasFloatingToolbar"] = action(() => {
    const toolbar = this.state.runtime.canvasFloatingToolbar;
    if (!toolbar.visible || toolbar.attachedCollection === null) {
      return false;
    }

    const editor = this.canvas.editor;
    if (editor === null) {
      return false;
    }

    const collectionRect = editor.queries.findEntityCollectionGridRect(
      toolbar.attachedCollection,
    );
    if (collectionRect === null) {
      return false;
    }

    // AI-REMOVED 2026-08-25:
    // Reason: 单独投影世界左上单元格无法代表旋转视角下的集合屏幕包围盒。
    // Trigger: 基地视角旋转后，悬浮工具条锚点沿错误的屏幕方向计算。
    // Evidence: 90°/180°/270° 下世界左上单元格不再是屏幕左上角，且世界 width 不再恒定映射到屏幕 X 轴。
    // Replacement: 下方 collectionClientRect 使用完整 collectionRect 的四角投影结果。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const topLeftCellRect = editor.queries.findClientRectForGridCell({
    //   x: collectionRect.x,
    //   y: collectionRect.y,
    // });
    // if (topLeftCellRect === null) {
    //   return false;
    // }
    const viewportState = this.canvas.view.state;
    const collectionClientRect = resolveViewportRectFromWorldGridRect({
      gridRect: collectionRect,
      viewportBounds: viewportState.clientRect,
      viewportCenter: viewportState.center,
      gridCellPixelSize: viewportState.gridCellPixelSize,
      displayRotation: viewportState.displayRotation,
    });
    if (collectionClientRect === null) {
      return false;
    }

    const toolbarHeight = toolbar.measuredSize?.height ?? DEFAULT_CANVAS_FLOATING_TOOLBAR_HEIGHT;
    const toolbarWidth = toolbar.measuredSize?.width ?? 0;
    const viewport = viewportState.clientRect;

    // AI-REMOVED 2026-08-25:
    // Reason: 完整集合屏幕包围盒已经包含旋转后的实际宽度，不应再用单格宽度乘世界 width 重建。
    // Trigger: 90°/270° 视角下集合的屏幕宽度对应世界 height。
    // Evidence: resolveViewportRectFromWorldGridRect 会基于四角投影计算旋转后的 width。
    // Replacement: aboveAnchor 直接使用 collectionClientRect.width。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const cellWidth = topLeftCellRect.width;

    const halfToolbarHeight = toolbarHeight / 2;

    const aboveAnchor: ClientPixelPoint = {
      x:
        collectionClientRect.left
        + collectionClientRect.width / 2,
      y:
        collectionClientRect.top
        - halfToolbarHeight
        - FLOATING_TOOLBAR_DEVICE_GAP_PX,
    };

    let anchor = aboveAnchor;

    const viewportTopSixth = viewport.top + viewport.height / 6;
    if (aboveAnchor.y < viewportTopSixth) {
      const viewportBottomFiveSixths = viewport.top + (viewport.height * 5) / 6;
      const belowY =
        collectionClientRect.top
        + collectionClientRect.height
        + halfToolbarHeight
        + FLOATING_TOOLBAR_DEVICE_GAP_PX;

      // AI-REMOVED 2026-08-25:
      // Reason: 世界底边单元格在旋转视角下不一定处于屏幕底边，不能用于计算工具条下方锚点。
      // Trigger: 集合靠近屏幕顶部时，90°/180°/270° 视角的下方回退位置仍会错乱。
      // Evidence: 完整集合投影的 bottom 恒为 collectionClientRect.top + collectionClientRect.height。
      // Replacement: 上方 belowY 基于 collectionClientRect 的屏幕底边计算。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const bottomCellY = collectionRect.y + collectionRect.height - 1;
      // const bottomCellRect = editor.queries.findClientRectForGridCell({
      //   x: collectionRect.x,
      //   y: bottomCellY,
      // });
      //
      // if (bottomCellRect !== null) {
      //   const belowY =
      //     bottomCellRect.top
      //     + bottomCellRect.height
      //     + halfToolbarHeight
      //     + FLOATING_TOOLBAR_DEVICE_GAP_PX;
      //
      //   if (belowY <= viewportBottomFiveSixths) {
      //     anchor = {
      //       x: aboveAnchor.x,
      //       y: belowY,
      //     };
      //   } else {
      //     anchor = {
      //       x: aboveAnchor.x,
      //       y: viewport.top + toolbarHeight * 1.5,
      //     };
      //   }
      // } else {
      //   anchor = {
      //     x: aboveAnchor.x,
      //     y: viewport.top + toolbarHeight * 1.5,
      //   };
      // }
      if (belowY <= viewportBottomFiveSixths) {
        anchor = {
          x: aboveAnchor.x,
          y: belowY,
        };
      } else {
        anchor = {
          x: aboveAnchor.x,
          y: viewport.top + toolbarHeight * 1.5,
        };
      }
    }

    if (toolbarWidth > 0) {
      const halfWidth = toolbarWidth / 2;
      const viewportLeft = viewport.left;
      const viewportRight = viewport.left + viewport.width;

      if (anchor.x - halfWidth < viewportLeft) {
        anchor = {
          x: viewportLeft + halfWidth,
          y: anchor.y,
        };
      } else if (anchor.x + halfWidth > viewportRight) {
        anchor = {
          x: viewportRight - halfWidth,
          y: anchor.y,
        };
      }
    }

    toolbar.anchor = anchor;
    return true;
  });

public readonly setCanvasFloatingToolbarSize: CanvasInternalAction["setCanvasFloatingToolbarSize"] = action((size) => {
    const nextSize = normalizeCanvasFloatingToolbarSize(size);
    const currentSize = this.state.runtime.canvasFloatingToolbar.measuredSize;

    if (
      currentSize?.width === nextSize?.width
      && currentSize?.height === nextSize?.height
    ) {
      return;
    }

    this.state.runtime.canvasFloatingToolbar.measuredSize = nextSize;
    this.alignCanvasFloatingToolbar();
  });

public readonly hideCanvasFloatingToolbar: CanvasInternalAction["hideCanvasFloatingToolbar"] = action(() => {
    if (
      !this.state.runtime.canvasFloatingToolbar.visible
      && this.state.runtime.canvasFloatingToolbar.buttonIds.length === 0
      && this.state.runtime.canvasFloatingToolbar.anchor === null
      && this.state.runtime.canvasFloatingToolbar.attachedCollection === null
    ) {
      return;
    }

    this.state.runtime.canvasFloatingToolbar.visible = false;
    this.state.runtime.canvasFloatingToolbar.buttonIds = [];
    this.state.runtime.canvasFloatingToolbar.anchor = null;
    this.state.runtime.canvasFloatingToolbar.attachedCollection = null;
  });

public readonly showCanvasRightDockToolbar: CanvasInternalAction["showCanvasRightDockToolbar"] = action((
    items,
  ) => {
    const nextItems = normalizeCanvasRightDockToolbarItems(items).filter(item => this.canvas.getOperationAvailability(item.operationId).supported);

    if (nextItems.length === 0) {
      this.hideCanvasRightDockToolbar();
      return;
    }

    this.state.runtime.canvasRightDockToolbar.visible = true;
    this.state.runtime.canvasRightDockToolbar.items = nextItems;
    // AI-REMOVED 2026-08-22:
    // Reason: 右侧工具列不再保存按钮数组和全局 mode。
    // Trigger: 每个功能请求独立声明 button/shortcut/both。
    // Evidence: nextItems 已包含归一化后的 operationId 与 presentation。
    // Replacement: canvasRightDockToolbar.items = nextItems。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // this.state.runtime.canvasRightDockToolbar.buttonIds = nextButtonIds;
    // this.state.runtime.canvasRightDockToolbar.mode = mode;
  });

public readonly hideCanvasRightDockToolbar: CanvasInternalAction["hideCanvasRightDockToolbar"] = action(() => {
    if (
      !this.state.runtime.canvasRightDockToolbar.visible
      && this.state.runtime.canvasRightDockToolbar.items.length === 0
    ) {
      return;
    }

    this.state.runtime.canvasRightDockToolbar.visible = false;
    this.state.runtime.canvasRightDockToolbar.items = [];
    // AI-REMOVED 2026-08-22:
    // Reason: 隐藏动作清理新的逐项请求状态。
    // Trigger: canvasRightDockToolbar.buttonIds 已被 items 替代。
    // Evidence: WorkbenchApp 从 items 渲染右侧工具列。
    // Replacement: canvasRightDockToolbar.items = []。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // this.state.runtime.canvasRightDockToolbar.buttonIds = [];
  });

public readonly showCanvasTopLeftCornerToolbar: CanvasInternalAction["showCanvasTopLeftCornerToolbar"] = action((
    buttonIds,
  ) => {
    const nextToolbarState = normalizeCanvasTopLeftCornerToolbarButtons(buttonIds);

    if (nextToolbarState.buttonIds.length === 0) {
      this.hideCanvasTopLeftCornerToolbar();
      return;
    }

    this.state.runtime.canvasTopLeftCornerToolbar.visible = true;
    this.state.runtime.canvasTopLeftCornerToolbar.buttonIds = nextToolbarState.buttonIds;
    this.state.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds =
      nextToolbarState.initialOffButtonIds;
  });

public readonly hideCanvasTopLeftCornerToolbar: CanvasInternalAction["hideCanvasTopLeftCornerToolbar"] = action(() => {
    if (
      !this.state.runtime.canvasTopLeftCornerToolbar.visible
      && this.state.runtime.canvasTopLeftCornerToolbar.buttonIds.length === 0
      && this.state.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds.length === 0
    ) {
      return;
    }

    this.state.runtime.canvasTopLeftCornerToolbar.visible = false;
    this.state.runtime.canvasTopLeftCornerToolbar.buttonIds = [];
    this.state.runtime.canvasTopLeftCornerToolbar.initialOffButtonIds = [];
  });
}

function normalizeCanvasFloatingToolbarButtonIds(
  buttonIds: readonly CanvasFloatingToolbarButtonId[],
): CanvasFloatingToolbarButtonId[] {
  const knownButtonIds = new Set<CanvasFloatingToolbarButtonId>(CANVAS_FLOATING_TOOLBAR_BUTTON_IDS);
  const deduped: CanvasFloatingToolbarButtonId[] = [];

  for (const buttonId of buttonIds) {
    if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
      continue;
    }

    deduped.push(buttonId);
  }

  return deduped;
}

function normalizeCanvasRightDockToolbarItems(
  items: readonly CanvasRightDockToolbarItemRequest[],
): CanvasRightDockToolbarItemRequest[] {
  const knownOperationIds = new Set<CanvasOperationId>(
    // AI-REMOVED 2026-11-12:
    // Reason: 场景共享契约迁入 Domain Shared，避免 Editor/App 各有一份语义。
    // Trigger: REQ-048 已确认 D2 契约。
    // Evidence: 会话、只读源与交互画布均需要相同标识和只读快照。
    // Replacement: Domain Shared CANVAS_OPERATION_IDS
    // Risk: 所有引用需同步迁移。
    // Human Review: Required
    // Original code:
    // CANVAS_RIGHT_DOCK_TOOLBAR_OPERATION_IDS,
    CANVAS_OPERATION_IDS,
  );
  const knownPresentations = new Set<CanvasRightDockToolbarPresentation>([
    "button",
    "shortcut",
    "both",
  ]);
  const seenOperationIds = new Set<CanvasOperationId>();
  const deduped: CanvasRightDockToolbarItemRequest[] = [];

  for (const item of items) {
    if (
      !knownOperationIds.has(item.operationId)
      || !knownPresentations.has(item.presentation)
      || seenOperationIds.has(item.operationId)
    ) {
      continue;
    }

    seenOperationIds.add(item.operationId);
    deduped.push({
      operationId: item.operationId,
      presentation: item.presentation,
    });
  }

  return deduped;
}

function normalizeCanvasTopLeftCornerToolbarButtons(
  buttonIds: readonly CanvasTopLeftCornerToolbarShowButtonId[],
): {
  buttonIds: CanvasTopLeftCornerToolbarButtonId[];
  initialOffButtonIds: CanvasTopLeftCornerToolbarButtonId[];
} {
  const knownButtonIds = new Set<CanvasTopLeftCornerToolbarButtonId>(
    CANVAS_TOP_LEFT_CORNER_TOOLBAR_BUTTON_IDS,
  );
  const deduped: CanvasTopLeftCornerToolbarButtonId[] = [];
  const initialOffButtonIds: CanvasTopLeftCornerToolbarButtonId[] = [];

  for (const requestedButtonId of buttonIds) {
    const isInitialOffButton = requestedButtonId.endsWith("-off");
    const buttonId = (isInitialOffButton
      ? requestedButtonId.slice(0, -4)
      : requestedButtonId) as CanvasTopLeftCornerToolbarButtonId;

    if (!knownButtonIds.has(buttonId) || deduped.includes(buttonId)) {
      continue;
    }

    deduped.push(buttonId);

    if (isInitialOffButton) {
      initialOffButtonIds.push(buttonId);
    }
  }

  return {
    buttonIds: deduped,
    initialOffButtonIds,
  };
}

function normalizeClientPixelPoint(
  clientPixelPoint: ClientPixelPoint,
): ClientPixelPoint | null {
  if (!Number.isFinite(clientPixelPoint.x) || !Number.isFinite(clientPixelPoint.y)) {
    return null;
  }

  return {
    x: clientPixelPoint.x,
    y: clientPixelPoint.y,
  };
}

function normalizeCanvasFloatingToolbarSize(
  size: CanvasFloatingToolbarSize | null,
): CanvasFloatingToolbarSize | null {
  if (
    size === null
    || !Number.isFinite(size.width)
    || !Number.isFinite(size.height)
    || size.width <= 0
    || size.height <= 0
  ) {
    return null;
  }

  return {
    width: size.width,
    height: size.height,
  };
}
