import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { observer } from "mobx-react-lite";

import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";

export interface DialogShellTab {
  id: string;
  label: string;
  content: ReactNode;
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
  immersiveMaximized?: boolean;
  showMaximizeButton?: boolean;
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
  immersiveMaximized = false,
  showMaximizeButton = true,
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
  const [liveSize, setLiveSize] = useState<{ width: number | null; height: number | null }>({
    width: null,
    height: null,
  });
  const activeTab = tabs.find((tab) => tab.id === dialogState.activeTab) ?? tabs[0] ?? null;
  const isDraggable = !dialogState.maximized && onOffsetChange !== undefined;
  const isResizable = !dialogState.maximized && onResize !== undefined;
  const maximizeButtonTitle = dialogState.maximized ? restoreTitle : maximizeTitle;

  useEffect(() => {
    if (!dialogState.visible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (onWindowKeyDown?.(event)) {
        return;
      }

      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dialogState.visible, onClose, onWindowKeyDown]);

  useEffect(() => {
    if (!dialogState.visible || dialogState.maximized) {
      dragCleanupRef.current?.();
      resizeCleanupRef.current?.();
    }
  }, [dialogState.visible, dialogState.maximized]);

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

  const resolvedShellStyle: CSSProperties | undefined = dialogState.maximized
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
    dialogState.maximized ? "is-maximized" : "",
  ].filter(Boolean).join(" ");
  const backdropClassName = [
    "dialog-shell-backdrop",
    `${classPrefix}-backdrop`,
    immersiveMaximized ? "is-immersive-maximized" : "",
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
      || target.closest("button, input, select, textarea, [data-dialog-shell-no-drag]") !== null
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

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isResizable || onResize === undefined) {
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
    const originWidth = shellElement?.offsetWidth ?? dialogState.width ?? 400;
    const originHeight = shellElement?.offsetHeight ?? dialogState.height ?? 300;

    resizeCleanupRef.current?.();
    document.body.classList.add("is-resizing-dialog-shell");

    const cleanup = () => {
      document.body.classList.remove("is-resizing-dialog-shell");
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
      const nextWidth = Math.max(320, originWidth + deltaX);
      const nextHeight = Math.max(240, originHeight + deltaY);

      setLiveSize({
        width: nextWidth,
        height: nextHeight,
      });
      onResize(nextWidth, nextHeight);
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

  return (
    <div
      className={backdropClassName}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={shellClassName}
        data-dialog-key={dialogKey}
        ref={shellRef}
        role="dialog"
        style={resolvedShellStyle}
      >
        <header className={headerClassName} onPointerDown={handleHeaderPointerDown}>
          <div className={headerMainClassName}>
            <div className={["dialog-shell-header-copy", `${classPrefix}-header-copy`].join(" ")}>
              <h2 id={titleId}>{title}</h2>
            </div>
            {/* AI-CORRECTION 2026-05-09:
                Archived note below记录的是“标题旁直接塞 tab 按钮”的旧失败方案。
                当前有效实现改为固定高度的 tab 轨道，仍与标题同行，但不会把 tab 渲染成右上角按钮组。
            */}
            {tabs.length > 0 ? (
              <div
                className={["dialog-shell-tab-strip", `${classPrefix}-tab-strip`].join(" ")}
                data-dialog-shell-no-drag
              >
                <div aria-label={title} className={["dialog-shell-tab-list", `${classPrefix}-tab-list`].join(" ")} role="tablist">
                  {tabs.map((tab) => {
                    const isActive = activeTab?.id === tab.id;

                    return (
                      <button
                        aria-controls={`${dialogKey}-dialog-panel-${tab.id}`}
                        aria-selected={isActive}
                        className={isActive
                          ? `dialog-shell-tab ${classPrefix}-tab is-active`
                          : `dialog-shell-tab ${classPrefix}-tab`}
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
            <div className={["dialog-shell-header-actions", `${classPrefix}-header-actions`].join(" ")}>
              {showMaximizeButton ? (
                <button
                  aria-label={maximizeButtonTitle}
                  className={`dialog-shell-header-button ${classPrefix}-header-button`}
                  onClick={onToggleMaximized}
                  title={maximizeButtonTitle}
                  type="button"
                >
                  <span className="top-bar-toggle-icon">
                    <WorkbenchIcon kind={dialogState.maximized ? "shrink" : "expand"} />
                  </span>
                  <span className="sr-only">{maximizeButtonTitle}</span>
                </button>
              ) : null}
              <button
                aria-label={closeTitle}
                className={`dialog-shell-header-button ${classPrefix}-header-button ${classPrefix}-close`}
                onClick={onClose}
                title={closeTitle}
                type="button"
              >
                <span className="top-bar-toggle-icon">
                  <WorkbenchIcon kind="cancel" />
                </span>
                <span className="sr-only">{closeTitle}</span>
              </button>
            </div>
          </div>
          {/* AI-REMOVED 2026-05-09:
              Reason: 将 tab 保留在 header 内会持续呈现为标题右侧按钮组，而不是独立页签带。
              Trigger: 用户反馈“都是问题”，且最新截图中 help/toolbox 对话框的 tab 仍然浮在 header 右侧，并带有错误的下划线与碎弧。
              Evidence: .temp/playwright-test/dialog-shell-help-tabs-v7.png 与 .temp/playwright-test/dialog-shell-toolbox-tabs-v7.png。
              Replacement: header 下方的 dialog-shell-tab-strip，同文件当前有效实现。
              Risk: Low
              Human Review: Required

              Original code:
              {tabs.length > 0 ? (
                <div aria-label={title} className={["dialog-shell-tab-list", `${classPrefix}-tab-list`].join(" ")} role="tablist">
                  {tabs.map((tab) => {
                    const isActive = activeTab?.id === tab.id;

                    return (
                      <button
                        aria-controls={`${dialogKey}-dialog-panel-${tab.id}`}
                        aria-selected={isActive}
                        className={isActive
                          ? `dialog-shell-tab ${classPrefix}-tab is-active`
                          : `dialog-shell-tab ${classPrefix}-tab`}
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
              ) : null}
          */}
        </header>
        {/* AI-REMOVED 2026-05-09:
            Reason: 用户要求标题与 tab 同行，独立第二行 tab-strip 不再满足目标。
            Trigger: 需求明确要求“先 dialog 标题，然后后面跟 tab”，同时要求切换 tab 时 content 尺寸不能跳动。
            Evidence: 当前实现虽然形态正确，但 tab-strip 单独占一行，和最新要求冲突。
            Replacement: dialog-shell-header-main 内的固定高度 dialog-shell-tab-strip。
            Risk: Low
            Human Review: Required

            Original code:
            {tabs.length > 0 ? (
              <div className={["dialog-shell-tab-strip", `${classPrefix}-tab-strip`].join(" ")}>
                <div aria-label={title} className={["dialog-shell-tab-list", `${classPrefix}-tab-list`].join(" ")} role="tablist">
                  {tabs.map((tab) => {
                    const isActive = activeTab?.id === tab.id;

                    return (
                      <button
                        aria-controls={`${dialogKey}-dialog-panel-${tab.id}`}
                        aria-selected={isActive}
                        className={isActive
                          ? `dialog-shell-tab ${classPrefix}-tab is-active`
                          : `dialog-shell-tab ${classPrefix}-tab`}
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
        */}
        <div className={bodyClassNames}>
          {activeTab === null ? children : (
            <section
              aria-labelledby={`${dialogKey}-dialog-tab-${activeTab.id}`}
              className="dialog-shell-tab-panel"
              id={`${dialogKey}-dialog-panel-${activeTab.id}`}
              role="tabpanel"
            >
              {activeTab.content}
            </section>
          )}
        </div>
        {isResizable ? (
          <div
            className="dialog-shell-resize-grip"
            onPointerDown={handleResizePointerDown}
          />
        ) : null}
      </section>
    </div>
  );
});
