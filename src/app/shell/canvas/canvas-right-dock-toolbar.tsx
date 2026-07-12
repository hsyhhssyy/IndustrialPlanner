import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { CanvasRightDockToolbarButtonId } from "@/app/state/state-impl";
import type { UiKey } from "@/shared/i18n";
import {
  Fragment,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type CanvasRightDockToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasRightDockToolbarTone = "exit";
type CanvasRightDockToolbarMode = "icon" | "shortcut";

interface CanvasRightDockToolbarDefinition {
  readonly labelKey: UiKey;
  icon: CanvasRightDockToolbarIconKind;
  tone?: CanvasRightDockToolbarTone;
  shortcutKeyId?: ShortcutKeyId;
}

interface CanvasRightDockToolbarProps {
  appHost: AppHost;
  buttonIds: readonly CanvasRightDockToolbarButtonId[];
  mode?: CanvasRightDockToolbarMode;
}

const CANVAS_RIGHT_DOCK_TOOLBAR_DEFINITIONS: Record<
  CanvasRightDockToolbarButtonId,
  CanvasRightDockToolbarDefinition
> = {
  "canvas-right-dock-toolbar-button-exit": {
    labelKey: "action.exit",
    icon: "cancel",
    tone: "exit",
    shortcutKeyId: SHORTCUT_KEY.RETURN_SELECT,
  },
  "canvas-right-dock-toolbar-button-move": {
    labelKey: "tool.move",
    icon: "move",
    shortcutKeyId: SHORTCUT_KEY.MOVE_SELECTION,
  },
  "canvas-right-dock-toolbar-button-save-blueprint": {
    labelKey: "action.saveBlueprint",
    icon: "save-blueprint",
    shortcutKeyId: SHORTCUT_KEY.SAVE_BLUEPRINT,
  },
  "canvas-right-dock-toolbar-button-copy": {
    labelKey: "action.copySelection",
    icon: "copy",
    shortcutKeyId: SHORTCUT_KEY.COPY_SELECTION,
  },
  "canvas-right-dock-toolbar-button-delete": {
    labelKey: "action.deleteSelection",
    icon: "delete",
    shortcutKeyId: SHORTCUT_KEY.DELETE_DEVICE,
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export const CanvasRightDockToolbar = observer(function CanvasRightDockToolbar({
  appHost,
  buttonIds,
  mode = "icon",
}: CanvasRightDockToolbarProps) {
  const t = appHost.actions.translate;
  // AI-REMOVED 2026-06-19:
  // Reason: 右侧工具栏只负责渲染手势模组声明的按钮，不应持有“保存蓝图何时显示”的业务规则。
  // Trigger: marquee 模式下选区操作按钮的显示规则统一回收到手势模组。
  // Evidence: showCanvasRightDockToolbar 已由各手势模组负责传入完整 buttonIds。
  // Replacement: hypergryph-marquee-gesture-module.ts 的 showMarqueeRightDockToolbar。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const canSaveBlueprint = (appHost.workspace.editor?.state.collections.selection.length ?? 0) > 1;
  // const visibleButtonIds = buttonIds.filter(
  //   (buttonId) => canSaveBlueprint || buttonId !== "canvas-right-dock-toolbar-button-save-blueprint",
  // );
  const visibleButtonIds = buttonIds;

  const isShortcutMode = mode === "shortcut";

  const stopUiPropagation = (
    event:
      | ReactMouseEvent<HTMLElement>
      | ReactPointerEvent<HTMLElement>
      | ReactWheelEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
  };

  const stopUiPropagationAndDefault = (
    event: ReactMouseEvent<HTMLElement> | ReactWheelEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const stopTouchPointerDownPropagation = (event: ReactPointerEvent<HTMLElement>) => {
    preventTouchPointerCompatibilityMouseEvents(event);
    event.stopPropagation();
  };

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: CanvasRightDockToolbarButtonId,
  ) => {
    event.stopPropagation();

    // 快捷键模式下不触发，让事件穿透
    if (isShortcutMode) return;

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: buttonId,
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
        uiButtonId: buttonId,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  function renderShortcutKeys(shortcutString: string): string[] {
    return shortcutString
      .split("+")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }

  return (
    <div
      aria-label={t("toolbar.canvasRightDock")}
      className={cm(styles, joinClassNames([
        "canvas-right-dock-toolbar",
        isShortcutMode ? "canvas-right-dock-toolbar--shortcut" : undefined,
      ]))}
      onAuxClick={stopUiPropagationAndDefault}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerCancel={stopUiPropagation}
      onPointerDown={stopUiPropagation}
      onPointerMove={stopUiPropagation}
      onPointerUp={stopUiPropagation}
      onWheel={stopUiPropagationAndDefault}
    >
      {visibleButtonIds.map((buttonId) => {
        const definition = CANVAS_RIGHT_DOCK_TOOLBAR_DEFINITIONS[buttonId];
        const label = t(definition.labelKey);

        const shortcutString =
          isShortcutMode && definition.shortcutKeyId
            ? appHost.internalActions.getKeyboardShortcutFor(definition.shortcutKeyId)
            : null;

        const shortcutKeys =
          shortcutString !== null && shortcutString !== ""
            ? renderShortcutKeys(shortcutString)
            : null;

        const showShortcutBadge = isShortcutMode && shortcutKeys !== null && shortcutKeys.length > 0;

        return (
          <button
            aria-label={label}
            className={cm(styles, joinClassNames([
              "canvas-right-dock-toolbar-button",
              definition.tone ? `is-${definition.tone}` : undefined,
            ]))}
            data-ui-button-id={buttonId}
            key={buttonId}
            onClick={stopUiPropagation}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopTouchPointerDownPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, buttonId);
            }}
            type="button"
          >
            {showShortcutBadge ? (
              <>
                {shortcutKeys.map((key, i) => (
                  <Fragment key={i}>
                    {i > 0 && (
                      <span className={cm(styles, "canvas-right-dock-toolbar-shortcut-plus")}>
                        +
                      </span>
                    )}
                    <kbd className={cm(styles, "canvas-right-dock-toolbar-shortcut-key")}>
                      {key}
                    </kbd>
                  </Fragment>
                ))}
              </>
            ) : (
              <WorkbenchIcon
                className={cm(styles, "canvas-right-dock-toolbar-icon")}
                kind={definition.icon}
              />
            )}
            <span
              className={cm(
                styles,
                isShortcutMode
                  ? "canvas-right-dock-toolbar-label--glow"
                  : "canvas-right-dock-toolbar-label",
              )}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
});
