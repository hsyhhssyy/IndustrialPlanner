import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { SHORTCUT_KEY, type ShortcutKeyId } from "@/app/actions/keyboard-shortcut-manager";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { CanvasRightDockToolbarButtonId } from "@/app/state/state-impl";
import type { MessageKey } from "@/shared/i18n/messages";
import {
  Fragment,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useState,
} from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type CanvasRightDockToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasRightDockToolbarTone = "exit";
type CanvasRightDockToolbarMode = "icon" | "shortcut";

interface CanvasRightDockToolbarDefinition {
  readonly labelKey: MessageKey;
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
  const canSaveBlueprint = (appHost.workspace.editor?.state.collections.selection.length ?? 0) > 1;
  const visibleButtonIds = buttonIds.filter(
    (buttonId) => canSaveBlueprint || buttonId !== "canvas-right-dock-toolbar-button-save-blueprint",
  );

  const isShortcutMode = mode === "shortcut";

  // Alt 键按下状态，用于快捷键模式下的点击穿透控制
  const [altHeld, setAltHeld] = useState(false);

  useEffect(() => {
    if (!isShortcutMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => setAltHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isShortcutMode]);

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

    // 快捷键模式下没有按 Alt 时不触发，让事件穿透
    if (isShortcutMode && !event.altKey) return;

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
        isShortcutMode && altHeld ? "canvas-right-dock-toolbar--shortcut-alt-active" : undefined,
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
              isShortcutMode ? "canvas-right-dock-toolbar-button--shortcut" : undefined,
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