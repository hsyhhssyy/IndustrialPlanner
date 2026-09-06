import type { AppHost } from "@/app/host/app-host";
import type { UiButtonHoldState } from "@/app/input/gesture/adapter";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useEffect, useState } from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const ROTATE_VIEW_BUTTON_ID = "canvas-bottom-left-secondary-toolbar-button-rotate-view";

interface CanvasBottomLeftSecondaryToolbarProps {
  appHost: AppHost;
  offsetForFloatingTools: boolean;
}

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function CanvasBottomLeftSecondaryToolbar({
  appHost,
  offsetForFloatingTools,
}: CanvasBottomLeftSecondaryToolbarProps) {
  const t = appHost.actions.translate;
  const label = t("action.rotateView");
  const [holdState, setHoldState] = useState<UiButtonHoldState>(() =>
    appHost.gestureAdapter.getUiButtonHoldState(),
  );

  useEffect(() => appHost.gestureAdapter.subscribeUiButtonHoldState(setHoldState), [appHost]);

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

  const handleRotateButtonPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    stopTouchPointerDownPropagation(event);
    if (
      (event.pointerType !== "mouse" && event.pointerType !== "touch" && event.pointerType !== "pen")
      || (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    appHost.gestureAdapter.handleUiButtonPressStart({
      uiButtonId: ROTATE_VIEW_BUTTON_ID,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  };

  const handleRotateButtonPressEnd = (
    event: ReactPointerEvent<HTMLButtonElement>,
    reason: "release" | "cancel",
  ) => {
    event.stopPropagation();
    if (
      event.pointerType !== "mouse"
      && event.pointerType !== "touch"
      && event.pointerType !== "pen"
    ) {
      return;
    }

    appHost.gestureAdapter.handleUiButtonPressEnd({
      uiButtonId: ROTATE_VIEW_BUTTON_ID,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    }, reason);
    if (
      typeof event.currentTarget.hasPointerCapture === "function"
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const showHoldProgress = holdState.visible && holdState.uiButtonId === ROTATE_VIEW_BUTTON_ID;

  return (
    <div
      aria-label={t("toolbar.canvasBottomLeftSecondary")}
      className={cm(styles, joinClassNames([
        "canvas-bottom-left-secondary-toolbar",
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
        className={cm(styles, "canvas-bottom-left-secondary-toolbar-button")}
        data-ui-button-id={ROTATE_VIEW_BUTTON_ID}
        onClick={stopUiPropagation}
        onContextMenu={stopUiPropagationAndDefault}
        onLostPointerCapture={(event) => handleRotateButtonPressEnd(event, "cancel")}
        onPointerCancel={(event) => handleRotateButtonPressEnd(event, "cancel")}
        onPointerDown={handleRotateButtonPointerDown}
        onPointerMove={stopUiPropagation}
        onPointerUp={(event) => handleRotateButtonPressEnd(event, "release")}
        title={label}
        type="button"
      >
        <WorkbenchIcon className={cm(styles, "canvas-bottom-left-secondary-toolbar-icon")} kind="rotate" />
        {showHoldProgress ? (
          <span
            aria-hidden="true"
            className={cm(styles, "canvas-bottom-left-secondary-toolbar-hold-progress")}
            key={holdState.gestureId ?? holdState.startedAt ?? "hold"}
          >
            <span
              className={cm(styles, "canvas-bottom-left-secondary-toolbar-hold-progress-fill")}
              style={{ animationDuration: `${holdState.durationMs}ms` }}
            />
          </span>
        ) : null}
        <span className={cm(styles, "sr-only")}>{label}</span>
      </button>
    </div>
  );
}
