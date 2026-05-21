import type { AppHost } from "@/app/host/app-host";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

interface CanvasBottomLeftToolbarProps {
  appHost: AppHost;
  offsetForFloatingTools: boolean;
}

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function CanvasBottomLeftToolbar({
  appHost,
  offsetForFloatingTools,
}: CanvasBottomLeftToolbarProps) {
  const t = appHost.actions.translate;
  const label = t("action.rotateView");

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

  const handleRotateButtonPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: "canvas-bottom-left-toolbar-button-rotate-view",
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
        uiButtonId: "canvas-bottom-left-toolbar-button-rotate-view",
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
      aria-label={t("toolbar.canvasBottomLeft")}
      className={cm(styles, joinClassNames([
        "canvas-bottom-left-toolbar",
        offsetForFloatingTools ? "is-offset-for-floating-tools" : undefined,
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
      <button
        aria-label={label}
        className={cm(styles, "canvas-bottom-left-toolbar-button")}
        data-ui-button-id="canvas-bottom-left-toolbar-button-rotate-view"
        onClick={stopUiPropagation}
        onContextMenu={stopUiPropagationAndDefault}
        onPointerCancel={stopUiPropagation}
        onPointerDown={stopTouchPointerDownPropagation}
        onPointerMove={stopUiPropagation}
        onPointerUp={handleRotateButtonPointerUp}
        title={label}
        type="button"
      >
        <WorkbenchIcon className={cm(styles, "canvas-bottom-left-toolbar-icon")} kind="rotate" />
        <span className={cm(styles, "sr-only")}>{label}</span>
      </button>
    </div>
  );
}
