import type { AppHost } from "@/app/host/app-host";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { CanvasRightDockToolbarButtonId } from "@/app/state/state-impl";
import type { MessageKey } from "@/shared/i18n/messages";
import {
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

type CanvasRightDockToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasRightDockToolbarTone = "exit";

interface CanvasRightDockToolbarDefinition {
  readonly labelKey: MessageKey;
  icon: CanvasRightDockToolbarIconKind;
  tone?: CanvasRightDockToolbarTone;
}

interface CanvasRightDockToolbarProps {
  appHost: AppHost;
  buttonIds: readonly CanvasRightDockToolbarButtonId[];
}

const CANVAS_RIGHT_DOCK_TOOLBAR_DEFINITIONS: Record<
  CanvasRightDockToolbarButtonId,
  CanvasRightDockToolbarDefinition
> = {
  "canvas-right-dock-toolbar-button-exit": {
    labelKey: "action.exit",
    icon: "cancel",
    tone: "exit",
  },
  "canvas-right-dock-toolbar-button-move": {
    labelKey: "tool.move",
    icon: "move",
  },
  "canvas-right-dock-toolbar-button-save-blueprint": {
    labelKey: "action.saveBlueprint",
    icon: "save-blueprint",
  },
  "canvas-right-dock-toolbar-button-copy": {
    labelKey: "action.copySelection",
    icon: "copy",
  },
  "canvas-right-dock-toolbar-button-delete": {
    labelKey: "action.deleteSelection",
    icon: "delete",
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function CanvasRightDockToolbar({
  appHost,
  buttonIds,
}: CanvasRightDockToolbarProps) {
  const t = appHost.actions.translate;

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

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: CanvasRightDockToolbarButtonId,
  ) => {
    event.stopPropagation();

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

  return (
    <div
      aria-label={t("toolbar.canvasRightDock")}
      className="canvas-right-dock-toolbar"
      onAuxClick={stopUiPropagationAndDefault}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerCancel={stopUiPropagation}
      onPointerDown={stopUiPropagation}
      onPointerMove={stopUiPropagation}
      onPointerUp={stopUiPropagation}
      onWheel={stopUiPropagationAndDefault}
    >
      {buttonIds.map((buttonId) => {
        const definition = CANVAS_RIGHT_DOCK_TOOLBAR_DEFINITIONS[buttonId];
        const label = t(definition.labelKey);

        return (
          <button
            aria-label={label}
            className={joinClassNames([
              "canvas-right-dock-toolbar-button",
              definition.tone ? `is-${definition.tone}` : undefined,
            ])}
            data-ui-button-id={buttonId}
            key={buttonId}
            onClick={stopUiPropagation}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopUiPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, buttonId);
            }}
            type="button"
          >
            <WorkbenchIcon className="canvas-right-dock-toolbar-icon" kind={definition.icon} />
            <span className="canvas-right-dock-toolbar-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}