import type { AppHost } from "@/app/host/app-host";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import {
  getVisiblePlacementOperationButtons,
  type PlacementOperationButtonDefinition,
} from "@/app/shell/panels/placement-operation-buttons";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

function renderButtonIcon(button: PlacementOperationButtonDefinition) {
  if (button.icon) {
    return <WorkbenchIcon className={cm(styles, "canvas-left-bottom-toolbar-icon")} kind={button.icon} />;
  }

  if (button.iconSrc) {
    return <img alt="" className={cm(styles, "canvas-left-bottom-toolbar-image")} src={button.iconSrc} />;
  }

  return null;
}

export function CanvasLeftBottomToolbar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  // 订阅 document 变化使管道按钮在切换基地后正确显示/隐藏
  useEditorDocumentSnapshot(editor);
  const buttonDefinitions = getVisiblePlacementOperationButtons(appHost);

  if (buttonDefinitions.length === 0) {
    return null;
  }

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
    button: PlacementOperationButtonDefinition,
  ) => {
    event.stopPropagation();

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: button.uiButtonId,
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
        uiButtonId: button.uiButtonId,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  return (
    <div
      aria-label={t("workbench.section.operation")}
      className={cm(styles, "canvas-left-bottom-toolbar")}
      onAuxClick={stopUiPropagationAndDefault}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerCancel={stopUiPropagation}
      onPointerDown={stopUiPropagation}
      onPointerMove={stopUiPropagation}
      onPointerUp={stopUiPropagation}
      onWheel={stopUiPropagationAndDefault}
    >
      {buttonDefinitions.map((button) => {
        const label = t(button.labelKey);
        const isActive = button.activeWhen?.(appHost) ?? false;

        return (
          <button
            aria-label={label}
            aria-pressed={button.activeWhen ? isActive : undefined}
            className={cm(styles, joinClassNames([
              "canvas-left-bottom-toolbar-button",
              isActive ? "is-active" : undefined,
            ]))}
            data-ui-button-id={button.uiButtonId}
            key={button.uiButtonId}
            onClick={stopUiPropagation}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopTouchPointerDownPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, button);
            }}
            title={label}
            type="button"
          >
            <span aria-hidden="true" className={cm(styles, "canvas-left-bottom-toolbar-button-icon")}>
              {renderButtonIcon(button)}
            </span>
          </button>
        );
      })}
    </div>
  );
}