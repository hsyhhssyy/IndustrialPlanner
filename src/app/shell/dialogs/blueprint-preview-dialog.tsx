import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { observer } from "mobx-react-lite";
import LucideChevronLeft from "~icons/lucide/chevron-left";
import LucideFolder from "~icons/lucide/folder";

import type { AppHost } from "@/app/host/app-host";
import type { WorkbenchBlueprintPreviewController } from "@/app/shell/state/blueprint-preview-dialog-state";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import type { BlueprintPreviewHandle, BlueprintPreviewViewport } from "@/domain/renderer";
import {
  createEmptyBlueprintLibraryDirectory,
  type BlueprintLibraryDirectoryListing,
  type BlueprintLibraryFolder,
  type BlueprintLibraryRecord,
} from "@/shared/blueprints/blueprint-library";
import {
  deleteBlueprintDocument,
  listBlueprintDirectory,
  readBlueprintFolder,
  saveBlueprintDocument,
} from "@/shared/storage/blueprint-storage";

const DEFAULT_BLUEPRINT_PREVIEW_VIEWPORT: BlueprintPreviewViewport = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};

const BLUEPRINT_PREVIEW_ZOOM_FACTOR = 1.12;
const MIN_BLUEPRINT_PREVIEW_ZOOM = 0.25;
const MAX_BLUEPRINT_PREVIEW_ZOOM = 6;

interface PreviewTouchPointerSnapshot {
  clientX: number;
  clientY: number;
}

interface PreviewTouchGestureState {
  activePointers: Map<number, PreviewTouchPointerSnapshot>;
  pinchDistance: number | null;
}

// AI-REMOVED 2026-05-09:
// Reason: 画布叠层已删除，更新时间文案不再显示，因此格式化函数没有活跃调用点。
// Trigger: 用户要求去掉画布叠层，并且不要再找地方安排这些信息。
// Evidence: blueprint-preview-dialog.tsx 中原先唯一消费格式化结果的 previewTimeSummary 已按同一轮需求归档删除。
// Replacement: None
// Risk: Low
// Human Review: Required
//
// Original code:
// function formatBlueprintTimestamp(locale: string, value: string): string {
//   const timestamp = new Date(value);
//
//   if (Number.isNaN(timestamp.getTime())) {
//     return value;
//   }
//
//   return new Intl.DateTimeFormat(locale, {
//     month: "2-digit",
//     day: "2-digit",
//     hour: "2-digit",
//     minute: "2-digit",
//   }).format(timestamp);
// }

function resolveBlueprintFootprint(record: BlueprintLibraryRecord) {
  const orderedEntities = record.entityOrder
    .map((entityId) => record.entities[entityId])
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined);

  if (orderedEntities.length === 0) {
    return {
      width: 0,
      height: 0,
    };
  }

  const minX = Math.min(...orderedEntities.map((entity) => entity.position.x));
  const maxX = Math.max(...orderedEntities.map((entity) => entity.position.x));
  const minY = Math.min(...orderedEntities.map((entity) => entity.position.y));
  const maxY = Math.max(...orderedEntities.map((entity) => entity.position.y));

  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

function resolveBlueprintPreviewStageSize(element: HTMLDivElement) {
  const clientRect = element.getBoundingClientRect();

  return {
    width: Math.max(1, Math.floor(clientRect.width || element.clientWidth || 0)),
    height: Math.max(1, Math.floor(clientRect.height || element.clientHeight || 0)),
  };
}

function clampBlueprintPreviewZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BLUEPRINT_PREVIEW_VIEWPORT.zoom;
  }

  return Math.min(MAX_BLUEPRINT_PREVIEW_ZOOM, Math.max(MIN_BLUEPRINT_PREVIEW_ZOOM, value));
}

function resolvePreviewTouchDistance(
  first: PreviewTouchPointerSnapshot,
  second: PreviewTouchPointerSnapshot,
): number {
  return Math.hypot(
    second.clientX - first.clientX,
    second.clientY - first.clientY,
  );
}

function resolveActivePreviewTouchDistance(
  gestureState: PreviewTouchGestureState,
): number | null {
  const pointers = Array.from(gestureState.activePointers.values());

  if (pointers.length < 2) {
    return null;
  }

  const [firstPointer, secondPointer] = pointers;

  if (firstPointer === undefined || secondPointer === undefined) {
    return null;
  }

  return resolvePreviewTouchDistance(firstPointer, secondPointer);
}

function mountBlueprintPreviewCanvas(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
) {
  canvas.ariaHidden = "true";
  canvas.dataset.blueprintPreviewCanvas = "true";
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.replaceChildren(canvas);
}

function formatBlueprintFolderPath(options: {
  readonly rootLabel: string;
  readonly folderStack: readonly BlueprintLibraryFolder[];
}): {
  readonly displayLabel: string;
  readonly fullLabel: string;
} {
  if (options.folderStack.length === 0) {
    return {
      displayLabel: options.rootLabel,
      fullLabel: options.rootLabel,
    };
  }

  const fullLabel = [options.rootLabel, ...options.folderStack.map((folder) => folder.name)].join(" / ");

  if (options.folderStack.length === 1) {
    return {
      displayLabel: fullLabel,
      fullLabel,
    };
  }

  const currentFolder = options.folderStack.at(-1);

  return {
    displayLabel: `${options.rootLabel} / … / ${currentFolder?.name ?? ""}`,
    fullLabel,
  };
}

async function resolveBlueprintFolderStack(
  parentFolderId: string | null,
): Promise<BlueprintLibraryFolder[]> {
  const folderStack: BlueprintLibraryFolder[] = [];
  const visitedFolderIds = new Set<string>();
  let currentFolderId = parentFolderId;

  while (currentFolderId !== null && !visitedFolderIds.has(currentFolderId)) {
    visitedFolderIds.add(currentFolderId);
    const folder = await readBlueprintFolder(currentFolderId);

    if (folder === null) {
      break;
    }

    folderStack.unshift(folder);
    currentFolderId = folder.parentFolderId;
  }

  return folderStack;
}

export const BlueprintPreviewDialog = observer(function BlueprintPreviewDialog({
  appHost,
  controller,
}: {
  appHost: AppHost;
  controller: WorkbenchBlueprintPreviewController;
}) {
  const t = appHost.actions.translate;
  const record = controller.record;
  const dialogState = controller.dialogState;
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isTabletLayout = appHost.state.screenProfile.deviceClass === "tablet";
  // AI-REMOVED 2026-05-09:
  // Reason: 画布叠层与更新时间文案已删除，locale 不再参与任何活跃格式化逻辑。
  // Trigger: 用户要求去掉画布叠层并直接删除这些信息，而不是迁移显示位置。
  // Evidence: formatBlueprintTimestamp 与 previewTimeSummary 已归档移除，locale 在当前组件内已无读取点。
  // Replacement: None
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const locale = appHost.state.settings.locale;
  const renderHost = appHost.workspace.render;
  const previewCanvasHostRef = useRef<HTMLDivElement | null>(null);
  const previewHandleRef = useRef<BlueprintPreviewHandle | null>(null);
  const previewViewportRef = useRef<BlueprintPreviewViewport>(DEFAULT_BLUEPRINT_PREVIEW_VIEWPORT);
  const moveFolderInitializationRequestIdRef = useRef(0);
  const moveDirectoryRequestIdRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const touchGestureStateRef = useRef<PreviewTouchGestureState>({
    activePointers: new Map(),
    pinchDistance: null,
  });
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [isMoveLoading, setIsMoveLoading] = useState(false);
  const [isMovePickerReady, setIsMovePickerReady] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [moveErrorMessage, setMoveErrorMessage] = useState<string | null>(null);
  const [moveFolderStack, setMoveFolderStack] = useState<BlueprintLibraryFolder[]>([]);
  const [moveDirectoryListing, setMoveDirectoryListing] = useState<BlueprintLibraryDirectoryListing>(
    createEmptyBlueprintLibraryDirectory(null),
  );
  const useImmersiveShell = isPhoneLayout
    || (dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile));
  const currentMoveFolder = moveFolderStack.length > 0 ? moveFolderStack[moveFolderStack.length - 1] ?? null : null;
  const currentMoveFolderId = currentMoveFolder?.folderId ?? null;
  const copy = appHost.state.settings.locale === "zh-CN"
    ? {
      title: "蓝图预览",
      close: "关闭",
      maximize: "最大化",
      restore: "还原",
      previewTitle: "蓝图预览",
      previewHint: "布局总览",
      place: "放置",
      placeHint: "将当前蓝图放置到场景",
      version: "版本",
      base: "地图",
      entities: "实体数",
      links: "连线数",
      footprint: "预估范围",
      boundingBox: "包围盒范围",
      anchor: "初始坐标",
      updatedAt: "更新时间",
      noDescription: "暂无描述",
      rendererNote: "蓝图信息",
      delete: "删除",
      deleteConfirm: "确认删除",
      deleteCancel: "取消",
      deleteFailed: "删除蓝图失败，请检查浏览器存储是否可用。",
      deleteHint: "将当前蓝图移入已删除列表",
      deleting: "删除中...",
      move: "移动",
      moveHint: "将当前蓝图移动到其他文件夹",
      moveCancel: "取消移动",
      moveConfirm: "移动",
      moveFailed: "移动蓝图失败，请检查浏览器存储是否可用。",
      moveLoading: "正在读取目录...",
      moving: "移动中...",
      moveTargetFolder: "目标文件夹",
      moveBack: "返回上一级",
      moveEmpty: "当前目录下没有子文件夹，可以直接移动到这里。",
      moveCurrentFolderNote: "当前蓝图已经位于这个目录。",
    }
    : {
      title: "Blueprint Preview",
      previewTitle: "Blueprint Preview",
      previewHint: "Layout Overview",
      place: "Place",
      placeHint: "Place this blueprint into the scene",
      version: "Version",
      base: "Base",
      entities: "Entities",
      links: "Links",
      footprint: "Footprint",
      boundingBox: "Bounding Box",
      anchor: "Anchor",
      updatedAt: "Updated",
      noDescription: "No description",
      rendererNote: "Blueprint Information",
      delete: "Delete",
      deleteConfirm: "Confirm Delete",
      deleteCancel: "Cancel",
      deleteFailed: "Failed to delete the blueprint. Check browser storage availability.",
      deleteHint: "Move this blueprint into deleted items",
      deleting: "Deleting...",
      move: "Move",
      moveHint: "Move this blueprint to another folder",
      moveCancel: "Cancel Move",
      moveConfirm: "Move Here",
      moveFailed: "Failed to move the blueprint. Check browser storage availability.",
      moveLoading: "Loading folders...",
      moving: "Moving...",
      moveTargetFolder: "Target Folder",
      moveBack: "Up One Level",
      moveEmpty: "This folder has no subfolders. You can move the blueprint here.",
      moveCurrentFolderNote: "This blueprint is already in the current folder.",
    };
  const rootFolderLabel = t("workbench.blueprint.rootFolder");

  useEffect(() => {
    setIsDeleteConfirming(false);
    setIsDeleting(false);
    setDeleteErrorMessage(null);
    setIsMoveMode(false);
    setIsMoveLoading(false);
    setIsMovePickerReady(false);
    setIsMoving(false);
    setMoveErrorMessage(null);
    setMoveFolderStack([]);
    setMoveDirectoryListing(createEmptyBlueprintLibraryDirectory(null));
  }, [controller.canDelete, dialogState.visible, record?.blueprintId]);

  useEffect(() => {
    if (!dialogState.visible || record === null || !controller.canDelete || !isMoveMode) {
      return;
    }

    let cancelled = false;
    const requestId = moveFolderInitializationRequestIdRef.current + 1;
    moveFolderInitializationRequestIdRef.current = requestId;

    setIsMoveLoading(true);
    setIsMovePickerReady(false);
    setMoveErrorMessage(null);

    void resolveBlueprintFolderStack(record.parentFolderId)
      .then((folderStack) => {
        if (cancelled || moveFolderInitializationRequestIdRef.current !== requestId) {
          return;
        }

        setMoveFolderStack(folderStack);
        setMoveDirectoryListing(
          createEmptyBlueprintLibraryDirectory(folderStack.at(-1)?.folderId ?? null),
        );
        setIsMovePickerReady(true);
      })
      .finally(() => {
        if (cancelled || moveFolderInitializationRequestIdRef.current !== requestId) {
          return;
        }

        setIsMoveLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [controller.canDelete, dialogState.visible, isMoveMode, record]);

  useEffect(() => {
    if (!dialogState.visible || record === null || !controller.canDelete || !isMoveMode || !isMovePickerReady) {
      return;
    }

    let cancelled = false;
    const requestId = moveDirectoryRequestIdRef.current + 1;
    moveDirectoryRequestIdRef.current = requestId;

    setIsMoveLoading(true);
    setMoveErrorMessage(null);
    setMoveDirectoryListing(createEmptyBlueprintLibraryDirectory(currentMoveFolderId));

    void listBlueprintDirectory(currentMoveFolderId)
      .then((listing) => {
        if (cancelled || moveDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setMoveDirectoryListing(listing);
      })
      .catch(() => {
        if (cancelled || moveDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setMoveErrorMessage(copy.moveFailed);
      })
      .finally(() => {
        if (cancelled || moveDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setIsMoveLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [controller.canDelete, copy.moveFailed, currentMoveFolderId, dialogState.visible, isMoveMode, isMovePickerReady, record]);

  const syncPreviewViewport = (viewport: Partial<BlueprintPreviewViewport>) => {
    previewViewportRef.current = {
      zoom: clampBlueprintPreviewZoom(viewport.zoom ?? previewViewportRef.current.zoom),
      offsetX: viewport.offsetX ?? previewViewportRef.current.offsetX,
      offsetY: viewport.offsetY ?? previewViewportRef.current.offsetY,
    };

    if (renderHost === null || previewHandleRef.current === null) {
      return;
    }

    renderHost.actions.updateBlueprintPreviewViewport(
      previewHandleRef.current,
      previewViewportRef.current,
    );
  };

  const stopPreviewDrag = (pointerId?: number) => {
    if (pointerId !== undefined && dragStateRef.current?.pointerId !== pointerId) {
      return;
    }

    dragStateRef.current = null;
  };

  const resetPreviewTouchGestures = () => {
    touchGestureStateRef.current.activePointers.clear();
    touchGestureStateRef.current.pinchDistance = null;
  };

  const syncPreviewTouchPinch = () => {
    const gestureState = touchGestureStateRef.current;
    const nextDistance = resolveActivePreviewTouchDistance(gestureState);

    if (nextDistance === null || nextDistance <= 0) {
      gestureState.pinchDistance = null;
      return;
    }

    const previousDistance = gestureState.pinchDistance;

    if (previousDistance !== null && previousDistance > 0 && nextDistance !== previousDistance) {
      syncPreviewViewport({
        zoom: previewViewportRef.current.zoom * (nextDistance / previousDistance),
      });
    }

    gestureState.pinchDistance = nextDistance;
  };

  const finalizePreviewTouchGesture = () => {
    const gestureState = touchGestureStateRef.current;

    if (gestureState.activePointers.size >= 2) {
      dragStateRef.current = null;
      gestureState.pinchDistance = resolveActivePreviewTouchDistance(gestureState);
      return;
    }

    gestureState.pinchDistance = null;

    const [remainingPointerEntry] = gestureState.activePointers.entries();

    if (remainingPointerEntry === undefined) {
      dragStateRef.current = null;
      return;
    }

    const [pointerId, pointer] = remainingPointerEntry;
    dragStateRef.current = {
      pointerId,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
    };
  };

  useEffect(() => {
    previewViewportRef.current = { ...DEFAULT_BLUEPRINT_PREVIEW_VIEWPORT };
    stopPreviewDrag();
    resetPreviewTouchGestures();
  }, [record?.blueprintId]);

  useEffect(() => {
    const previewCanvasHost = previewCanvasHostRef.current;

    if (!dialogState.visible || record === null || renderHost === null || previewCanvasHost === null) {
      return;
    }

    let active = true;
    let mountedHandle: BlueprintPreviewHandle | null = null;
    const previewStageSize = resolveBlueprintPreviewStageSize(previewCanvasHost);

    void renderHost.actions.mountBlueprintPreview({
      blueprint: record,
      width: previewStageSize.width,
      height: previewStageSize.height,
      viewport: previewViewportRef.current,
    }).then((handle) => {
      if (!active) {
        renderHost.actions.disposeBlueprintPreview(handle);
        return;
      }

      mountedHandle = handle;
      previewHandleRef.current = handle;
      const canvas = renderHost.queries.getBlueprintPreviewCanvas(handle);

      if (canvas !== null) {
        mountBlueprintPreviewCanvas(previewCanvasHost, canvas);
      }

      renderHost.actions.updateBlueprintPreviewViewport(handle, previewViewportRef.current);
    });

    return () => {
      active = false;
      stopPreviewDrag();
      resetPreviewTouchGestures();
      previewHandleRef.current = null;
      previewCanvasHost.replaceChildren();

      if (mountedHandle !== null) {
        renderHost.actions.disposeBlueprintPreview(mountedHandle);
      }
    };
  }, [dialogState.visible, record, renderHost]);

  useEffect(() => {
    const previewCanvasHost = previewCanvasHostRef.current;

    if (
      !dialogState.visible
      || previewCanvasHost === null
      || renderHost === null
      || typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (previewHandleRef.current === null) {
        return;
      }

      const previewStageSize = resolveBlueprintPreviewStageSize(previewCanvasHost);

      renderHost.actions.resizeBlueprintPreview(
        previewHandleRef.current,
        previewStageSize.width,
        previewStageSize.height,
      );
    });

    resizeObserver.observe(previewCanvasHost);

    return () => {
      resizeObserver.disconnect();
    };
  }, [dialogState.visible, renderHost, record?.blueprintId]);

  if (!dialogState.visible || record === null) {
    return null;
  }
  const footprint = resolveBlueprintFootprint(record);
  const moveFolderPath = formatBlueprintFolderPath({
    rootLabel: rootFolderLabel,
    folderStack: moveFolderStack,
  });
  const isMoveTargetCurrent = currentMoveFolderId === record.parentFolderId;
  const activeErrorMessage = moveErrorMessage ?? deleteErrorMessage;
  // AI-REMOVED 2026-05-09:
  // Reason: 用户要求去掉画布叠层，并且不要再找地方安排这些信息。
  // Trigger: 当前预览面板底部叠层继续显示“布局总览”、实体数、连线数、预估范围、初始坐标、地图、更新时间，和最新布局要求冲突。
  // Evidence: 当前 blueprint-preview-overlay 直接消费这些派生文案，删除叠层后这些派生值不再有有效承载位置。
  // Replacement: None
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const formattedUpdatedAt = formatBlueprintTimestamp(locale, record.updatedAt);
  // const previewSummary = `${copy.entities} ${record.entityOrder.length} · ${copy.links} ${record.slotLinks.length} · ${copy.footprint} ${footprint.width} x ${footprint.height}`;
  // const previewContextSummary = `${copy.anchor} (${record.initialGridPoint.x}, ${record.initialGridPoint.y}) · ${copy.base} ${record.baseId}`;
  // const previewTimeSummary = `${copy.updatedAt} ${formattedUpdatedAt}`;
  const handlePlaceButtonPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: "blueprint-preview-place-button",
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: "blueprint-preview-place-button",
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };
  const handlePlaceButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) {
      return;
    }

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "blueprint-preview-place-button",
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  };
  const handleDeleteButtonClick = async () => {
    if (!controller.canDelete) {
      return;
    }

    if (!isDeleteConfirming) {
      setIsDeleteConfirming(true);
      setDeleteErrorMessage(null);
      return;
    }

    setIsDeleting(true);
    setDeleteErrorMessage(null);

    try {
      const deletedRecord = await deleteBlueprintDocument(record.blueprintId);

      if (deletedRecord === null) {
        setDeleteErrorMessage(copy.deleteFailed);
        return;
      }

      controller.markDeleted();
      controller.close();
    } finally {
      setIsDeleting(false);
    }
  };
  const handleOpenMoveMode = () => {
    if (!controller.canDelete) {
      return;
    }

    setIsDeleteConfirming(false);
    setDeleteErrorMessage(null);
    setMoveErrorMessage(null);
    setIsMoveMode(true);
  };
  const handleMoveSubmit = async () => {
    if (!controller.canDelete || isMoveLoading || isMoving || isMoveTargetCurrent) {
      return;
    }

    setIsMoving(true);
    setMoveErrorMessage(null);

    try {
      const movedRecord = await saveBlueprintDocument(record, {
        parentFolderId: currentMoveFolderId,
      });

      if (movedRecord === null) {
        setMoveErrorMessage(copy.moveFailed);
        return;
      }

      controller.markMoved();
      controller.close();
    } finally {
      setIsMoving(false);
    }
  };
  const showDeleteAction = controller.canDelete;
  const showMoveAction = controller.canDelete;
  const actionsClassName = isDeleteConfirming
    ? "blueprint-preview-actions is-dual-action"
    : showMoveAction && showDeleteAction
      ? "blueprint-preview-actions is-triple-action"
      : "blueprint-preview-actions";
  const handlePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const zoomFactor = event.deltaY < 0
      ? BLUEPRINT_PREVIEW_ZOOM_FACTOR
      : 1 / BLUEPRINT_PREVIEW_ZOOM_FACTOR;

    syncPreviewViewport({
      zoom: previewViewportRef.current.zoom * zoomFactor,
    });
  };
  const handlePreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      touchGestureStateRef.current.activePointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      finalizePreviewTouchGesture();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const handlePreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      if (!touchGestureStateRef.current.activePointers.has(event.pointerId)) {
        return;
      }

      touchGestureStateRef.current.activePointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (touchGestureStateRef.current.activePointers.size >= 2) {
        dragStateRef.current = null;
        syncPreviewTouchPinch();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    const dragState = dragStateRef.current;

    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.clientX;
    const deltaY = event.clientY - dragState.clientY;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    syncPreviewViewport({
      offsetX: previewViewportRef.current.offsetX + deltaX,
      offsetY: previewViewportRef.current.offsetY + deltaY,
    });
    event.preventDefault();
    event.stopPropagation();
  };
  const handlePreviewPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      touchGestureStateRef.current.activePointers.delete(event.pointerId);
      finalizePreviewTouchGesture();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    stopPreviewDrag(event.pointerId);
  };

  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      width: isPhoneLayout ? "100dvw" : isTabletLayout ? "720px" : "760px",
      height: isPhoneLayout ? "100dvh" : isTabletLayout ? "720px" : "680px",
      minHeight: isPhoneLayout ? "100dvh" : "520px",
    }
    : undefined;

  return (
    <DialogShell
      bodyClassName="blueprint-preview-dialog-body"
      className="blueprint-preview-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isPhoneLayout}
      dialogKey="blueprint-preview"
      dialogState={dialogState}
      immersiveMaximized={useImmersiveShell}
      maximizeTitle={t("dialog.maximize")}
      onClose={controller.close}
      onOffsetChange={controller.setOffset}
      onResize={isPhoneLayout ? undefined : controller.setSize}
      onToggleMaximized={controller.toggleMaximized}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={copy.title}
      titleId="blueprint-preview-dialog-title"
    >
      <div className="blueprint-preview-dialog-content">
        <section className="blueprint-preview-layout" aria-label={copy.previewTitle}>
          <div className="blueprint-preview-stage">
            <div className="blueprint-preview-canvas-shell">
              <div
                className="blueprint-preview-canvas"
                onLostPointerCapture={handlePreviewPointerUp}
                onPointerCancel={handlePreviewPointerUp}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={handlePreviewPointerUp}
                onWheel={handlePreviewWheel}
                ref={previewCanvasHostRef}
              />
              {/* AI-REMOVED 2026-05-09:
                  Reason: 用户要求去掉画布叠层，并且这些信息不要再迁移到其他区域。
                  Trigger: blueprint preview 左侧画布仍然显示布局总览 badge 和底部摘要文字。
                  Evidence: 当前 blueprint-preview-overlay 仍占用画布前景层并渲染 previewHint / previewSummary / previewContextSummary / previewTimeSummary。
                  Replacement: None
                  Risk: Low
                  Human Review: Required

                  Original code:
                  <div className="blueprint-preview-overlay">
                    <span className="blueprint-preview-canvas-label">{copy.previewHint}</span>
                    <div className="blueprint-preview-overlay-copy">
                      <p>{previewSummary}</p>
                      <p>{previewContextSummary}</p>
                      <p>{previewTimeSummary}</p>
                    </div>
                  </div>
              */}
            </div>
            {/* AI-REMOVED 2026-05-09:
                Reason: 左侧只保留预览面板本体，指标信息收拢到画布叠层，避免预览区下方再挂独立信息块。
                Trigger: 用户要求左侧只留下预览面板，并把实体数、连线数、预估范围、初始坐标、地图、更新时间等都归到预览面板内。
                Evidence: 当前 stage metrics 与 renderer note 会把左侧切成多块，不符合“只留下预览面板”的布局目标。
                Replacement: blueprint-preview-overlay-copy
                Risk: Low
                Human Review: Required

                Original code:
                <div className="blueprint-preview-stage-metrics">
                  <span className="pill">{copy.entities}: {record.entityOrder.length}</span>
                  <span className="pill">{copy.footprint}: {footprint.width} x {footprint.height}</span>
                  <span className="pill">{copy.anchor}: ({record.initialGridPoint.x}, {record.initialGridPoint.y})</span>
                </div>
                <p aria-label={copy.rendererNote} className="blueprint-preview-renderer-note">{rendererSummary}</p>
            */}
          </div>
          <div className={isMoveMode
            ? "blueprint-preview-summary-card is-folder-picker-mode"
            : "blueprint-preview-summary-card"}
          >
            {isMoveMode ? (
              <section
                aria-label={copy.moveTargetFolder}
                className="blueprint-preview-folder-picker-card"
              >
                {activeErrorMessage === null ? null : (
                  <p className="save-blueprint-error" role="alert">{activeErrorMessage}</p>
                )}
                <div className="blueprint-preview-folder-picker-toolbar">
                  {currentMoveFolder === null ? null : (
                    <button
                      aria-label={copy.moveBack}
                      className="blueprint-utility-button blueprint-preview-folder-picker-back-button"
                      data-ui-button-id="blueprint-preview-move-back-button"
                      disabled={isMoveLoading || isMoving}
                      onClick={() => {
                        setMoveErrorMessage(null);
                        setMoveFolderStack((currentValue) => currentValue.slice(0, -1));
                      }}
                      type="button"
                    >
                      <LucideChevronLeft className="button-icon-image" />
                    </button>
                  )}
                  <span
                    className="blueprint-preview-folder-picker-path"
                    data-blueprint-preview-move-breadcrumb
                    title={moveFolderPath.fullLabel}
                  >
                    {moveFolderPath.displayLabel}
                  </span>
                </div>
                {isMoveLoading ? (
                  <p className="blueprint-preview-footnote">{copy.moveLoading}</p>
                ) : moveDirectoryListing.folders.length === 0 ? (
                  <p className="blueprint-preview-footnote">{copy.moveEmpty}</p>
                ) : (
                  <div className="blueprint-preview-folder-picker-list">
                    {moveDirectoryListing.folders.map((folder) => (
                      <button
                        className="save-blueprint-secondary-button blueprint-preview-folder-picker-entry"
                        data-blueprint-preview-folder-id={folder.folderId}
                        key={folder.folderId}
                        onClick={() => {
                          setMoveErrorMessage(null);
                          setMoveFolderStack((currentValue) => [...currentValue, folder]);
                        }}
                        title={folder.name}
                        type="button"
                      >
                        <span aria-hidden="true" className="button-icon blueprint-preview-folder-picker-entry-icon">
                          <LucideFolder className="button-icon-image" />
                        </span>
                        <span className="blueprint-preview-folder-picker-entry-label">{folder.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {isMoveTargetCurrent ? (
                  <p className="blueprint-preview-footnote">{copy.moveCurrentFolderNote}</p>
                ) : null}
                <div className="blueprint-preview-actions is-dual-action blueprint-preview-folder-picker-actions">
                  <button
                    className="save-blueprint-secondary-button"
                    data-ui-button-id="blueprint-preview-move-cancel-button"
                    disabled={isMoveLoading || isMoving}
                    onClick={() => {
                      setIsMoveMode(false);
                      setMoveErrorMessage(null);
                    }}
                    type="button"
                  >
                    {copy.moveCancel}
                  </button>
                  <button
                    className="save-blueprint-primary-button"
                    data-ui-button-id="blueprint-preview-move-confirm-button"
                    disabled={isMoveLoading || isMoving || isMoveTargetCurrent}
                    onClick={() => {
                      void handleMoveSubmit();
                    }}
                    type="button"
                  >
                    {isMoving ? copy.moving : copy.moveConfirm}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <div className="blueprint-preview-header">
                  <div className="blueprint-preview-header-copy">
                    <h3>{record.name}</h3>
                    <p>{record.description.length > 0 ? record.description : copy.noDescription}</p>
                  </div>
                </div>
                {activeErrorMessage === null ? null : (
                  <p className="save-blueprint-error" role="alert">{activeErrorMessage}</p>
                )}
                <div className={actionsClassName}>
                  {isDeleteConfirming ? (
                    <>
                      <button
                        className="save-blueprint-secondary-button"
                        data-ui-button-id="blueprint-preview-delete-cancel-button"
                        disabled={isDeleting}
                        onClick={() => {
                          setIsDeleteConfirming(false);
                          setDeleteErrorMessage(null);
                        }}
                        type="button"
                      >
                        {copy.deleteCancel}
                      </button>
                      <button
                        className="save-blueprint-primary-button blueprint-preview-danger-button is-confirm"
                        data-ui-button-id="blueprint-preview-delete-confirm-button"
                        disabled={isDeleting}
                        onClick={() => {
                          void handleDeleteButtonClick();
                        }}
                        type="button"
                      >
                        {isDeleting ? copy.deleting : copy.deleteConfirm}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="save-blueprint-primary-button"
                        data-ui-button-id="blueprint-preview-place-button"
                        onClick={handlePlaceButtonClick}
                        onPointerDown={preventTouchPointerCompatibilityMouseEvents}
                        onPointerUp={handlePlaceButtonPointerUp}
                        title={copy.placeHint}
                        type="button"
                      >
                        {copy.place}
                      </button>
                      {showMoveAction ? (
                        <button
                          className="save-blueprint-secondary-button"
                          data-ui-button-id="blueprint-preview-move-button"
                          onClick={handleOpenMoveMode}
                          title={copy.moveHint}
                          type="button"
                        >
                          {copy.move}
                        </button>
                      ) : null}
                      {showDeleteAction ? (
                        <button
                          className="save-blueprint-secondary-button blueprint-preview-danger-button"
                          data-ui-button-id="blueprint-preview-delete-button"
                          onClick={() => {
                            void handleDeleteButtonClick();
                          }}
                          title={copy.deleteHint}
                          type="button"
                        >
                          {copy.delete}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
                <dl className="blueprint-preview-metadata">
                  <dt>{copy.entities}</dt>
                  <dd>{record.entityOrder.length}</dd>
                  <dt>{copy.version}</dt>
                  <dd>{record.version}</dd>
                  <dt>{copy.boundingBox}</dt>
                  <dd>{footprint.width} x {footprint.height}</dd>
                </dl>
              </>
            )}
            {/* AI-REMOVED 2026-05-09:
                Reason: 右侧数据栏收窄后，只保留 name / desc、实体数、版本和包围盒范围；放置按钮独立成一行，避免压缩说明文字宽度。
                Trigger: 用户要求右侧只留下窄数据面板，且放置按钮不要挤占说明文字空间。
                Evidence: 旧 header 采用“说明文字 + 按钮”双列布局，长名称或描述会被按钮直接压缩；metadata 项也超出用户要求。
                Replacement: blueprint-preview-actions + 精简后的 blueprint-preview-metadata
                Risk: Low
                Human Review: Required

                Original code:
                <button
                  className="save-blueprint-primary-button"
                  data-ui-button-id="blueprint-preview-place-button"
                  onClick={handlePlaceButtonClick}
                  onPointerDown={preventTouchPointerCompatibilityMouseEvents}
                  onPointerUp={handlePlaceButtonPointerUp}
                  title={copy.placeHint}
                  type="button"
                >
                  {copy.place}
                </button>
                <dt>{copy.base}</dt>
                <dd>{record.baseId}</dd>
                <dt>{copy.links}</dt>
                <dd>{record.slotLinks.length}</dd>
                <dt>{copy.footprint}</dt>
                <dd>{footprint.width} x {footprint.height}</dd>
                <dt>{copy.anchor}</dt>
                <dd>({record.initialGridPoint.x}, {record.initialGridPoint.y})</dd>
                <dt>{copy.updatedAt}</dt>
                <dd>{formattedUpdatedAt}</dd>
            */}
            {/* AI-REMOVED 2026-05-09:
                Reason: 移除预览卡底部的说明性脚注，避免 UI 出现不必要的提示性副标题。
                Trigger: 用户要求新建 UI 不要展示开发性质 hint，也不要添加不需要的说明性质文案。
                Evidence: 当前卡片已有主动作按钮与完整元信息，脚注只是在重复说明“放置”动作。
                Replacement: None
                Risk: Low
                Human Review: Required

                Original code:
                <p className="blueprint-preview-footnote">{copy.placeHint}</p>
            */}
          </div>
        </section>
      </div>
    </DialogShell>
  );
});