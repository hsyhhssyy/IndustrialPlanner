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

import {
  downloadBlueprintDocumentForTransfer,
  serializeBlueprintDocumentForTransfer,
} from "@/app/blueprint/blueprint-transfer";
import type { AppHost } from "@/app/host/app-host";
import { canPlaceBlueprintDocumentInCurrentBase } from "@/app/placement-zone-availability";
import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
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
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

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
    // Reason: 画布叠层与更新时间文案已删除，locale 不再参与任何活跃格式化逻辑。
  // Trigger: 用户要求去掉画布叠层并直接删除这些信息，而不是迁移显示位置。
  // Evidence: formatBlueprintTimestamp 与 previewTimeSummary 已归档移除，locale 在当前组件内已无读取点。
  // Replacement: None
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const locale = appHost.state.settings.locale;
  const editor = appHost.workspace.editor;
  // 订阅 document 变化使蓝图放置按钮在切换基地后正确更新
  useEditorDocumentSnapshot(editor);
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
  const [isCopying, setIsCopying] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [moveErrorMessage, setMoveErrorMessage] = useState<string | null>(null);
  const [transferErrorMessage, setTransferErrorMessage] = useState<string | null>(null);
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
      placeOriginal: "放置到原位 (调试模式)",
      placeOriginalHint: "将当前蓝图放置到保存时的原始位置",
      placeBlockedByBase: "包含不可放置设备",
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
      edit: "编辑详细信息",
      editHint: "修改蓝图名称、描述或保存位置",
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
      placeOriginal: "Place at Origin (Debug)",
      placeOriginalHint: "Place this blueprint at its original saved position",
      placeBlockedByBase: "Contains unplaceable devices",
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
      edit: "Edit Details",
      editHint: "Edit the blueprint name, description, or saved folder",
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
    setIsCopying(false);
    setMoveErrorMessage(null);
    setTransferErrorMessage(null);
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
  const activeErrorMessage = transferErrorMessage ?? moveErrorMessage ?? deleteErrorMessage;
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
  const canPlaceBlueprint = canPlaceBlueprintDocumentInCurrentBase(appHost, record);
  const handlePlaceButtonPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canPlaceBlueprint) {
      return;
    }

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
    if (!canPlaceBlueprint) {
      return;
    }

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
  const handlePlaceOriginalButtonClick = () => {
    if (!canPlaceBlueprint) {
      return;
    }

    const editor = appHost.workspace.editor;
    if (editor === null || editor.actions.createBlueprintPlacementDraft === undefined) {
      return;
    }

    try {
      editor.actions.createBlueprintPlacementDraft(record, record.initialGridPoint);
      const applied = editor.actions.applyPlacementDraft();
      if (!applied) {
        editor.actions.cancelPlacementDraft();
        return;
      }
      controller.close();
    } catch {
      // 放置失败，静默忽略
    }
  };
  const handleDeleteButtonClick = async () => {
    if (!controller.canDelete) {
      return;
    }

    setTransferErrorMessage(null);

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
    setTransferErrorMessage(null);
    const editableRecord = record;

    controller.close();

    if (typeof window === "undefined") {
      appHost.saveBlueprintDialog.openEdit(editableRecord);
      return;
    }

    window.setTimeout(() => {
      appHost.saveBlueprintDialog.openEdit(editableRecord);
    }, 0);
  };
  const handleExportButtonClick = () => {
    setTransferErrorMessage(null);

    try {
      downloadBlueprintDocumentForTransfer(record);
    } catch {
      setTransferErrorMessage(t("workbench.blueprint.exportFileFailed"));
    }
  };
  const handleCopyButtonClick = async () => {
    if (isCopying) {
      return;
    }

    if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
      setTransferErrorMessage(t("workbench.blueprint.copyClipboardUnavailable"));
      return;
    }

    setIsCopying(true);
    setTransferErrorMessage(null);

    try {
      await navigator.clipboard.writeText(serializeBlueprintDocumentForTransfer(record));
    } catch {
      setTransferErrorMessage(t("workbench.blueprint.copyClipboardFailed"));
    } finally {
      setIsCopying(false);
    }
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
  const defaultActionCount = 3 + (showMoveAction ? 1 : 0) + (showDeleteAction ? 1 : 0);
  const actionsClassName = isDeleteConfirming
    ? "blueprint-preview-actions is-dual-action"
    : defaultActionCount >= 3
      ? "blueprint-preview-actions is-triple-action"
      : defaultActionCount === 2
        ? "blueprint-preview-actions is-dual-action"
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
      // TapTap 手机端按 Chrome 89 兼容；Chrome 89 不支持 inline style 中的 dvh/dvw，手机对话框使用 vh/vw。
      width: isPhoneLayout ? "100vw" : isTabletLayout ? "720px" : "760px",
      height: isPhoneLayout ? "100vh" : isTabletLayout ? "720px" : "680px",
      minHeight: isPhoneLayout ? "100vh" : "520px",
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
      <div className={cm(styles, "blueprint-preview-dialog-content")}>
        <section className={cm(styles, "blueprint-preview-layout")} aria-label={copy.previewTitle}>
          <div className={cm(styles, "blueprint-preview-stage")}>
            <div className={cm(styles, "blueprint-preview-canvas-shell")}>
              <div
                className={cm(styles, "blueprint-preview-canvas")}
                onLostPointerCapture={handlePreviewPointerUp}
                onPointerCancel={handlePreviewPointerUp}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={handlePreviewPointerUp}
                onWheel={handlePreviewWheel}
                ref={previewCanvasHostRef}
              />
              {}
            </div>
            {}
          </div>
          <div className={cm(styles, isMoveMode
            ? "blueprint-preview-summary-card is-folder-picker-mode"
            : "blueprint-preview-summary-card")}
          >
            {isMoveMode ? (
              <section
                aria-label={copy.moveTargetFolder}
                className={cm(styles, "blueprint-preview-folder-picker-card")}
              >
                {activeErrorMessage === null ? null : (
                  <p className={cm(styles, "save-blueprint-error")} role="alert">{activeErrorMessage}</p>
                )}
                <div className={cm(styles, "blueprint-preview-folder-picker-toolbar")}>
                  {currentMoveFolder === null ? null : (
                    <button
                      aria-label={copy.moveBack}
                      className={cm(styles, "blueprint-utility-button blueprint-preview-folder-picker-back-button")}
                      data-ui-button-id="blueprint-preview-move-back-button"
                      disabled={isMoveLoading || isMoving}
                      onClick={() => {
                        setMoveErrorMessage(null);
                        setMoveFolderStack((currentValue) => currentValue.slice(0, -1));
                      }}
                      type="button"
                    >
                      <LucideChevronLeft className={cm(styles, "button-icon-image")} />
                    </button>
                  )}
                  <span
                    className={cm(styles, "blueprint-preview-folder-picker-path")}
                    data-blueprint-preview-move-breadcrumb
                    title={moveFolderPath.fullLabel}
                  >
                    {moveFolderPath.displayLabel}
                  </span>
                </div>
                {isMoveLoading ? (
                  <p className={cm(styles, "blueprint-preview-footnote")}>{copy.moveLoading}</p>
                ) : moveDirectoryListing.folders.length === 0 ? (
                  <p className={cm(styles, "blueprint-preview-footnote")}>{copy.moveEmpty}</p>
                ) : (
                  <div className={cm(styles, "blueprint-preview-folder-picker-list")}>
                    {moveDirectoryListing.folders.map((folder) => (
                      <button
                        className={cm(styles, "save-blueprint-secondary-button blueprint-preview-folder-picker-entry")}
                        data-blueprint-preview-folder-id={folder.folderId}
                        key={folder.folderId}
                        onClick={() => {
                          setMoveErrorMessage(null);
                          setMoveFolderStack((currentValue) => [...currentValue, folder]);
                        }}
                        title={folder.name}
                        type="button"
                      >
                        <span aria-hidden="true" className={cm(styles, "button-icon blueprint-preview-folder-picker-entry-icon")}>
                          <LucideFolder className={cm(styles, "button-icon-image")} />
                        </span>
                        <span className={cm(styles, "blueprint-preview-folder-picker-entry-label")}>{folder.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {isMoveTargetCurrent ? (
                  <p className={cm(styles, "blueprint-preview-footnote")}>{copy.moveCurrentFolderNote}</p>
                ) : null}
                <div className={cm(styles, "blueprint-preview-actions is-dual-action blueprint-preview-folder-picker-actions")}>
                  <button
                    className={cm(styles, "save-blueprint-secondary-button")}
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
                    className={cm(styles, "save-blueprint-primary-button")}
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
                <div className={cm(styles, "blueprint-preview-header")}>
                  <div className={cm(styles, "blueprint-preview-header-copy")}>
                    <h3>{record.name}</h3>
                    <p className={cm(styles, "blueprint-preview-description")}>
                      {record.description.length > 0 ? record.description : copy.noDescription}
                    </p>
                  </div>
                </div>
                {activeErrorMessage === null ? null : (
                  <p className={cm(styles, "save-blueprint-error")} role="alert">{activeErrorMessage}</p>
                )}
                <div className={cm(styles, actionsClassName)}>
                  {isDeleteConfirming ? (
                    <>
                      <button
                        className={cm(styles, "save-blueprint-secondary-button")}
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
                        className={cm(styles, "save-blueprint-primary-button blueprint-preview-danger-button is-confirm")}
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
                        className={cm(styles, "save-blueprint-primary-button")}
                        data-ui-button-id="blueprint-preview-place-button"
                        disabled={!canPlaceBlueprint}
                        onClick={handlePlaceButtonClick}
                        onPointerDown={preventTouchPointerCompatibilityMouseEvents}
                        onPointerUp={handlePlaceButtonPointerUp}
                        title={copy.placeHint}
                        type="button"
                      >
                        {canPlaceBlueprint ? copy.place : copy.placeBlockedByBase}
                      </button>
                      {appHost.state.settings.debugMode ? (
                        <button
                          className={cm(styles, "save-blueprint-primary-button")}
                          data-ui-button-id="blueprint-preview-place-original-button"
                          disabled={!canPlaceBlueprint}
                          onClick={handlePlaceOriginalButtonClick}
                          title={copy.placeOriginalHint}
                          type="button"
                        >
                          {canPlaceBlueprint ? copy.placeOriginal : copy.placeBlockedByBase}
                        </button>
                      ) : null}
                      <button
                        className={cm(styles, "save-blueprint-secondary-button")}
                        data-ui-button-id="blueprint-preview-export-file-button"
                        onClick={handleExportButtonClick}
                        title={t("workbench.button.exportBlueprintToFile")}
                        type="button"
                      >
                        {t("workbench.button.exportBlueprintToFile")}
                      </button>
                      <button
                        className={cm(styles, "save-blueprint-secondary-button")}
                        data-ui-button-id="blueprint-preview-copy-clipboard-button"
                        disabled={isCopying}
                        onClick={() => {
                          void handleCopyButtonClick();
                        }}
                        title={t("workbench.button.copyBlueprintToClipboard")}
                        type="button"
                      >
                        {t("workbench.button.copyBlueprintToClipboard")}
                      </button>
                      {showMoveAction ? (
                        <button
                          className={cm(styles, "save-blueprint-secondary-button")}
                          data-ui-button-id="blueprint-preview-move-button"
                          onClick={handleOpenMoveMode}
                          title={copy.editHint}
                          type="button"
                        >
                          {copy.edit}
                        </button>
                      ) : null}
                      {showDeleteAction ? (
                        <button
                          className={cm(styles, "save-blueprint-secondary-button blueprint-preview-danger-button")}
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
                <dl className={cm(styles, "blueprint-preview-metadata")}>
                  <dt>{copy.entities}</dt>
                  <dd>{record.entityOrder.length}</dd>
                  <dt>{copy.version}</dt>
                  <dd>{record.version}</dd>
                  <dt>{copy.boundingBox}</dt>
                  <dd>{footprint.width} x {footprint.height}</dd>
                </dl>
              </>
            )}
            {}
            {}
          </div>
        </section>
      </div>
    </DialogShell>
  );
});
