import type { AppHost } from "@/app/app-host";
import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import type { CanvasToolbarButtonId } from "@/app/state-impl";
import type { ClientPixelPoint } from "@/domain/types/client-pixel";
import type { ComponentProps, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

type CanvasActionIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasActionTone = "cancel" | "confirm" | "delete" | "rotate";

interface CanvasActionToolbarDefinition {
  readonly ariaLabel: {
    readonly "zh-CN": string;
    readonly "en-US": string;
  };
  icon: CanvasActionIconKind;
  tone?: CanvasActionTone;
}

interface CanvasActionToolbarProps {
  appHost: AppHost;
  buttonIds: readonly CanvasToolbarButtonId[];
  anchor: ClientPixelPoint;
}

const CANVAS_ACTION_TOOLBAR_DEFINITIONS: Record<CanvasToolbarButtonId, CanvasActionToolbarDefinition> = {
  "canvas-toolbar-button-ok": {
    ariaLabel: {
      "zh-CN": "确认",
      "en-US": "Confirm",
    },
    icon: "confirm",
    tone: "confirm",
  },
  "canvas-toolbar-button-cancel": {
    ariaLabel: {
      "zh-CN": "取消",
      "en-US": "Cancel",
    },
    icon: "cancel",
    tone: "cancel",
  },
  "canvas-toolbar-button-rotate": {
    ariaLabel: {
      "zh-CN": "旋转",
      "en-US": "Rotate",
    },
    icon: "rotate",
    tone: "rotate",
  },
  "canvas-toolbar-button-delete": {
    ariaLabel: {
      "zh-CN": "删除",
      "en-US": "Delete",
    },
    icon: "delete",
    tone: "delete",
  },
  "canvas-toolbar-button-delete-many": {
    ariaLabel: {
      "zh-CN": "批量删除",
      "en-US": "Delete Many",
    },
    icon: "delete",
    tone: "delete",
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function CanvasActionToolbar({
  appHost,
  buttonIds,
  anchor,
}: CanvasActionToolbarProps) {
  const locale = appHost.state.settings.locale;

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
    buttonId: CanvasToolbarButtonId,
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
      aria-label="canvas toolbar"
      className="canvas-action-toolbar"
      onAuxClick={stopUiPropagationAndDefault}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerCancel={stopUiPropagation}
      onPointerDown={stopUiPropagation}
      onPointerMove={stopUiPropagation}
      onPointerUp={stopUiPropagation}
      onWheel={stopUiPropagationAndDefault}
      style={{
        left: `${anchor.x}px`,
        top: `${anchor.y}px`,
      }}
    >
      {buttonIds.map((buttonId) => {
        const definition = CANVAS_ACTION_TOOLBAR_DEFINITIONS[buttonId];
        const ariaLabel = definition.ariaLabel[locale];

        return (
        <button
          aria-label={ariaLabel}
          className={joinClassNames([
            "canvas-toolbar-button",
            "canvas-action-button",
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
          <WorkbenchIcon className="canvas-action-icon" kind={definition.icon} />
          <span className="sr-only">{ariaLabel}</span>
        </button>
        );
      })}
    </div>
  );
}