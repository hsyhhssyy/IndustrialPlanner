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
        onPointerUp={stopUiPropagation}
        title={label}
        type="button"
      >
        <WorkbenchIcon className={cm(styles, "canvas-bottom-left-toolbar-icon")} kind="rotate" />
        <span className={cm(styles, "sr-only")}>{label}</span>
      </button>
    </div>
  );
}
