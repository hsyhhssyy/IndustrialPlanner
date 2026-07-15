import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { observer } from "mobx-react-lite";

import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { useOverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export interface DialogShellTab {
  id: string;
  label: string;
  content: ReactNode;
}

type DialogShellResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type DialogShellResizeCursor = "ns" | "ew" | "nesw" | "nwse";

const DIALOG_SHELL_MIN_WIDTH = 320;
const DIALOG_SHELL_MIN_HEIGHT = 240;
const DIALOG_SHELL_RESIZE_DIRECTIONS: readonly DialogShellResizeDirection[] = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
];

function resolveDialogShellResizeAxes(options: {
  direction: DialogShellResizeDirection;
  canResizeWidth: boolean;
  canResizeHeight: boolean;
}): { width: boolean; height: boolean } {
  return {
    width: options.canResizeWidth && (options.direction.includes("e") || options.direction.includes("w")),
    height: options.canResizeHeight && (options.direction.includes("n") || options.direction.includes("s")),
  };
}

function resolveDialogShellResizeCursor(
  direction: DialogShellResizeDirection,
  axes: { width: boolean; height: boolean },
): DialogShellResizeCursor {
  if (axes.width && !axes.height) {
    return "ew";
  }

  if (!axes.width && axes.height) {
    return "ns";
  }

  if (direction === "ne" || direction === "sw") {
    return "nesw";
  }

  if (direction === "nw" || direction === "se") {
    return "nwse";
  }

  return direction === "n" || direction === "s" ? "ns" : "ew";
}

interface DialogShellProps {
  dialogKey: string;
  dialogState: DialogStateReadWrite;
  title: string;
  titleId: string;
  tabs?: readonly DialogShellTab[];
  className?: string;
  bodyClassName?: string;
  shellStyle?: CSSProperties;
  compactMobileLayout?: boolean;
  maximizeTitle: string;
  restoreTitle: string;
  closeTitle: string;
  headerActions?: ReactNode;
  immersiveMaximized?: boolean;
  showMaximizeButton?: boolean;
  resizableWidth?: boolean;
  resizableHeight?: boolean;
  modal?: boolean;
  onClose: () => void;
  onToggleMaximized: () => void;
  onTabChange?: (tabId: string) => void;
  onOffsetChange?: (offsetX: number, offsetY: number) => void;
  onResize?: (width: number, height: number) => void;
  onWindowKeyDown?: (event: KeyboardEvent) => boolean;
  children?: ReactNode;
}

export const DialogShell = observer(function DialogShell({
  dialogKey,
  dialogState,
  title,
  titleId,
  tabs = [],
  className,
  bodyClassName,
  shellStyle,
  compactMobileLayout = false,
  maximizeTitle,
  restoreTitle,
  closeTitle,
  headerActions,
  immersiveMaximized = false,
  showMaximizeButton = true,
  resizableWidth = true,
  resizableHeight = true,
  modal = true,
  onClose,
  onToggleMaximized,
  onTabChange,
  onOffsetChange,
  onResize,
  onWindowKeyDown,
  children,
}: DialogShellProps) {
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const overlayLayer = useOverlayStackLayer({
    layerId: dialogKey,
    visible: dialogState.visible,
  });
  const [liveSize, setLiveSize] = useState<{ width: number | null; height: number | null }>({
    width: null,
    height: null,
  });
  const activeTab = tabs.find((tab) => tab.id === dialogState.activeTab) ?? tabs[0] ?? null;
  const isFixedMobileLayout = compactMobileLayout;
  const isEffectivelyMaximized = !isFixedMobileLayout && dialogState.maximized;
  const isDraggable = !isFixedMobileLayout && !isEffectivelyMaximized && onOffsetChange !== undefined;
  const canResizeWidth = !isFixedMobileLayout && !isEffectivelyMaximized && onResize !== undefined && resizableWidth;
  const canResizeHeight = !isFixedMobileLayout && !isEffectivelyMaximized && onResize !== undefined && resizableHeight;
  const effectiveShowMaximizeButton = showMaximizeButton && !isFixedMobileLayout;
  const maximizeButtonTitle = dialogState.maximized ? restoreTitle : maximizeTitle;
  const resizeDirections = DIALOG_SHELL_RESIZE_DIRECTIONS.filter((direction) => {
    const axes = resolveDialogShellResizeAxes({
      direction,
      canResizeWidth,
      canResizeHeight,
    });

    if ((axes.width || axes.height) && onOffsetChange === undefined) {
      return false;
    }

    return axes.width || axes.height;
  });

  useEffect(() => {
    if (!dialogState.visible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!overlayLayer.isTop) {
        return;
      }

      if (onWindowKeyDown?.(event)) {
        event.stopImmediatePropagation();
        return;
      }

      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dialogState.visible, onClose, onWindowKeyDown, overlayLayer.isTop]);

  useEffect(() => {
    if (!dialogState.visible || isEffectivelyMaximized || isFixedMobileLayout) {
      dragCleanupRef.current?.();
      resizeCleanupRef.current?.();
    }
  }, [dialogState.visible, isEffectivelyMaximized, isFixedMobileLayout]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      resizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    setLiveSize({
      width: dialogState.width,
      height: dialogState.height,
    });
  }, [dialogState.height, dialogState.width, dialogState.visible, dialogState.maximized]);

  if (!dialogState.visible) {
    return null;
  }

  const resolvedShellStyle: CSSProperties | undefined = isEffectivelyMaximized || isFixedMobileLayout
    ? shellStyle
    : {
      transform: `translate(${dialogState.offsetX}px, ${dialogState.offsetY}px)`,
      ...(liveSize.width === null ? {} : { width: `${liveSize.width}px` }),
      ...(liveSize.height === null ? {} : { height: `${liveSize.height}px` }),
      ...shellStyle,
    };
  const classPrefix = className ?? "dialog-shell";
  const shellClassName = [
    "dialog-shell",
    className,
    tabs.length > 0 ? "has-tabs" : "",
    compactMobileLayout ? "is-mobile-compact" : "",
    isFixedMobileLayout ? "is-mobile-fixed" : "",
    isEffectivelyMaximized ? "is-maximized" : "",
  ].filter(Boolean).join(" ");
  const backdropClassName = [
    "dialog-shell-backdrop",
    `${classPrefix}-backdrop`,
    immersiveMaximized ? "is-immersive-maximized" : "",
    modal ? "" : "is-non-modal",
  ].filter(Boolean).join(" ");
  const headerClassName = [
    "dialog-shell-header",
    `${classPrefix}-header`,
    tabs.length > 0 ? "has-tabs" : "",
    isDraggable ? "is-draggable" : "",
  ].filter(Boolean).join(" ");
  const headerMainClassName = [
    "dialog-shell-header-main",
    `${classPrefix}-header-main`,
  ].join(" ");
  const bodyClassNames = [
    "dialog-shell-body",
    bodyClassName,
  ].filter(Boolean).join(" ");

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isDraggable || onOffsetChange === undefined) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const target = event.target;
    if (
      !(target instanceof HTMLElement)
      || target.closest("button, input, select, textarea") !== null
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = dialogState.offsetX;
    const originY = dialogState.offsetY;

    dragCleanupRef.current?.();
    document.body.classList.add("is-dragging-dialog-shell");

    const cleanup = () => {
      document.body.classList.remove("is-dragging-dialog-shell");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);

      if (dragCleanupRef.current === cleanup) {
        dragCleanupRef.current = null;
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      onOffsetChange(
        originX + moveEvent.clientX - startX,
        originY + moveEvent.clientY - startY,
      );
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) {
        return;
      }

      cleanup();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    dragCleanupRef.current = cleanup;
  };

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    direction: DialogShellResizeDirection,
  ) => {
    const axes = resolveDialogShellResizeAxes({
      direction,
      canResizeWidth,
      canResizeHeight,
    });

    if (
      onResize === undefined
      || (!axes.width && !axes.height)
      || onOffsetChange === undefined
    ) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;

    // 获取当前实际渲染的尺寸作为起始尺寸
    const shellElement = shellRef.current;
    const renderedWidth = shellElement?.offsetWidth;
    const renderedHeight = shellElement?.offsetHeight;
    const originWidth = renderedWidth !== undefined && renderedWidth > 0
      ? renderedWidth
      : dialogState.width ?? 400;
    const originHeight = renderedHeight !== undefined && renderedHeight > 0
      ? renderedHeight
      : dialogState.height ?? 300;
    const originOffsetX = dialogState.offsetX;
    const originOffsetY = dialogState.offsetY;

    resizeCleanupRef.current?.();
    const cursor = resolveDialogShellResizeCursor(direction, axes);
    document.body.classList.add("is-resizing-dialog-shell");
    document.body.classList.add(`is-resizing-dialog-shell-${direction}`);
    document.body.classList.add(`is-resizing-dialog-shell-cursor-${cursor}`);

    const cleanup = () => {
      document.body.classList.remove("is-resizing-dialog-shell");
      document.body.classList.remove(`is-resizing-dialog-shell-${direction}`);
      document.body.classList.remove(`is-resizing-dialog-shell-cursor-${cursor}`);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);

      if (resizeCleanupRef.current === cleanup) {
        resizeCleanupRef.current = null;
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      let nextWidth = originWidth;
      let nextHeight = originHeight;
      let nextOffsetX = originOffsetX;
      let nextOffsetY = originOffsetY;

      if (axes.width && direction.includes("e")) {
        nextWidth = Math.max(DIALOG_SHELL_MIN_WIDTH, originWidth + deltaX);
        nextOffsetX = originOffsetX + (nextWidth - originWidth) / 2;
      }

      if (axes.width && direction.includes("w")) {
        nextWidth = Math.max(DIALOG_SHELL_MIN_WIDTH, originWidth - deltaX);
        nextOffsetX = originOffsetX + (originWidth - nextWidth) / 2;
      }

      if (axes.height && direction.includes("s")) {
        nextHeight = Math.max(DIALOG_SHELL_MIN_HEIGHT, originHeight + deltaY);
        nextOffsetY = originOffsetY + (nextHeight - originHeight) / 2;
      }

      if (axes.height && direction.includes("n")) {
        nextHeight = Math.max(DIALOG_SHELL_MIN_HEIGHT, originHeight - deltaY);
        nextOffsetY = originOffsetY + (originHeight - nextHeight) / 2;
      }

      setLiveSize({
        width: axes.width ? nextWidth : dialogState.width,
        height: axes.height ? nextHeight : dialogState.height,
      });
      onResize(nextWidth, nextHeight);

      if (nextOffsetX !== originOffsetX || nextOffsetY !== originOffsetY) {
        onOffsetChange?.(nextOffsetX, nextOffsetY);
      }
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) {
        return;
      }

      cleanup();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    resizeCleanupRef.current = cleanup;
  };

  const dialogElement = (
    <div
      className={cm(styles, backdropClassName)}
      onMouseDown={(event) => {
        if (!modal) {
          return;
        }

        if (event.target !== event.currentTarget) {
          return;
        }

        onClose();
      }}
      style={{ zIndex: overlayLayer.zIndex }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal={modal}
        className={cm(styles, shellClassName)}
        data-dialog-key={dialogKey}
        ref={shellRef}
        role="dialog"
        style={resolvedShellStyle}
      >
        <header className={cm(styles, headerClassName)} onPointerDown={handleHeaderPointerDown}>
          <div className={cm(styles, headerMainClassName)}>
            <div className={cm(styles, "dialog-shell-header-copy", `${classPrefix}-header-copy`)}>
              <h2 id={titleId}>{title}</h2>
            </div>
            {/* AI-CORRECTION 2026-05-09:
                Archived note below记录的是“标题旁直接塞 tab 按钮”的旧失败方案。
                当前有效实现改为固定高度的 tab 轨道，仍与标题同行，但不会把 tab 渲染成右上角按钮组。
            */}
            {tabs.length > 0 ? (
              <div
                className={cm(styles, "dialog-shell-tab-strip", `${classPrefix}-tab-strip`)}
              >
                <div aria-label={title} className={cm(styles, "dialog-shell-tab-list", `${classPrefix}-tab-list`)} role="tablist">
                  {tabs.map((tab) => {
                    const isActive = activeTab?.id === tab.id;

                    return (
                      <button
                        aria-controls={`${dialogKey}-dialog-panel-${tab.id}`}
                        aria-selected={isActive}
                        className={cm(styles, "dialog-shell-tab", `${classPrefix}-tab`, isActive ? "is-active" : undefined)}
                        id={`${dialogKey}-dialog-tab-${tab.id}`}
                        key={tab.id}
                        onClick={() => {
                          onTabChange?.(tab.id);
                        }}
                        role="tab"
                        type="button"
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className={cm(styles, "dialog-shell-header-actions", `${classPrefix}-header-actions`)}>
              {headerActions}
              {effectiveShowMaximizeButton ? (
                <button
                  aria-label={maximizeButtonTitle}
                  className={cm(styles, "dialog-shell-header-button", `${classPrefix}-header-button`)}
                  onClick={onToggleMaximized}
                  title={maximizeButtonTitle}
                  type="button"
                >
                  <span className={cm(styles, "top-bar-toggle-icon")}>
                    <WorkbenchIcon kind={dialogState.maximized ? "dialog-collapse" : "dialog-expand"} />
                  </span>
                  <span className={cm(styles, "sr-only")}>{maximizeButtonTitle}</span>
                </button>
              ) : null}
              <button
                aria-label={closeTitle}
                className={cm(styles, "dialog-shell-header-button", `${classPrefix}-header-button`, `${classPrefix}-close`)}
                onClick={onClose}
                title={closeTitle}
                type="button"
              >
                <span className={cm(styles, "top-bar-toggle-icon")}>
                  <WorkbenchIcon kind="cancel" />
                </span>
                <span className={cm(styles, "sr-only")}>{closeTitle}</span>
              </button>
            </div>
          </div>
          {}
        </header>
        {}
        <div className={cm(styles, bodyClassNames)}>
          {activeTab === null ? children : (
            <section
              aria-labelledby={`${dialogKey}-dialog-tab-${activeTab.id}`}
              className={cm(styles, "dialog-shell-tab-panel")}
              id={`${dialogKey}-dialog-panel-${activeTab.id}`}
              role="tabpanel"
            >
              {activeTab.content}
            </section>
          )}
        </div>
        {/* AI-REMOVED 2026-07-14:
            Reason: 右下角单点 resize grip 与用户要求的 Windows 式八方向边缘 resize 冲突。
            Trigger: 用户要求移除右下角句柄绘制，并改为窗口边缘八个方向调整。
            Evidence: DialogShell 当前统一负责浮窗尺寸交互，替代实现已在下方按 direction 渲染边缘热区。
            Replacement: DialogShell resizeDirections.map(...) in this file.
            Risk: Low
            Human Review: Required

            Original code:
            {isResizable ? (
              <div
                className={cm(styles, "dialog-shell-resize-grip")}
                onPointerDown={handleResizePointerDown}
              />
            ) : null}
        */}
        {resizeDirections.map((direction) => {
          const axes = resolveDialogShellResizeAxes({
            direction,
            canResizeWidth,
            canResizeHeight,
          });
          const cursor = resolveDialogShellResizeCursor(direction, axes);

          return (
            <div
              aria-hidden="true"
              className={cm(
                styles,
                "dialog-shell-resize-edge",
                `dialog-shell-resize-edge--${direction}`,
                `dialog-shell-resize-edge--cursor-${cursor}`,
              )}
              key={direction}
              onPointerDown={(event) => handleResizePointerDown(event, direction)}
            />
          );
        })}
      </section>
    </div>
  );

  if (overlayLayer.portalHost === null) {
    return dialogElement;
  }

  return createPortal(dialogElement, overlayLayer.portalHost);
});
