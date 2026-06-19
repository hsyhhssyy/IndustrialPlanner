import type { AppHost } from "@/app/host/app-host";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { CanvasFloatingToolbarButtonId } from "@/app/state/state-impl";
import {
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type CanvasFloatingToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasFloatingToolbarTone = "cancel" | "confirm" | "delete" | "rotate";

interface CanvasFloatingToolbarDefinition {
  readonly label: {
    readonly "zh-CN": string;
    readonly "en-US": string;
  };
  icon: CanvasFloatingToolbarIconKind;
  tone?: CanvasFloatingToolbarTone;
}

interface CanvasFloatingToolbarButtonStripProps {
  appHost: AppHost;
  buttonIds: readonly CanvasFloatingToolbarButtonId[];
  buttonClassName: string;
  iconClassName: string;
  labelClassName?: string;
  showLabels?: boolean;
}

const CANVAS_FLOATING_TOOLBAR_DEFINITIONS: Record<CanvasFloatingToolbarButtonId, CanvasFloatingToolbarDefinition> = {
  "canvas-floating-toolbar-button-ok": {
    label: {
      "zh-CN": "确认",
      "en-US": "Confirm",
    },
    icon: "confirm",
    tone: "confirm",
  },
  "canvas-floating-toolbar-button-cancel": {
    label: {
      "zh-CN": "取消",
      "en-US": "Cancel",
    },
    icon: "cancel",
    tone: "cancel",
  },
  "canvas-floating-toolbar-button-rotate": {
    label: {
      "zh-CN": "旋转",
      "en-US": "Rotate",
    },
    icon: "rotate",
    tone: "rotate",
  },
  "canvas-floating-toolbar-button-switch-mode": {
    label: {
      "zh-CN": "切换模式",
      "en-US": "Switch Mode",
    },
    icon: "switch-mode",
  },
  "canvas-floating-toolbar-button-move": {
    label: {
      "zh-CN": "移动",
      "en-US": "Move",
    },
    icon: "move",
  },
  "canvas-floating-toolbar-button-copy": {
    label: {
      "zh-CN": "复制",
      "en-US": "Copy",
    },
    icon: "copy",
    tone: "confirm",
  },
  "canvas-floating-toolbar-button-save-blueprint": {
    label: {
      "zh-CN": "保存蓝图",
      "en-US": "Save Blueprint",
    },
    icon: "save-blueprint",
  },
  "canvas-floating-toolbar-button-delete": {
    label: {
      "zh-CN": "删除",
      "en-US": "Delete",
    },
    icon: "delete",
    tone: "delete",
  },
  "canvas-floating-toolbar-button-delete-many": {
    label: {
      "zh-CN": "删除整段",
      "en-US": "Delete Segment",
    },
    icon: "stop-outlined",
    tone: "delete",
  },
  "canvas-floating-toolbar-button-delete-upstream-segment": {
    label: {
      "zh-CN": "删除前段",
      "en-US": "Delete Upstream",
    },
    icon: "remove-backward",
    tone: "delete",
  },
  "canvas-floating-toolbar-button-delete-downstream-segment": {
    label: {
      "zh-CN": "删除后段",
      "en-US": "Delete Downstream",
    },
    icon: "remove-forward",
    tone: "delete",
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function CanvasFloatingToolbarButtonStrip({
  appHost,
  buttonIds,
  buttonClassName,
  iconClassName,
  labelClassName,
  showLabels = false,
}: CanvasFloatingToolbarButtonStripProps) {
  const locale = appHost.state.settings.locale;

  const stopUiPropagation = (
    event:
      | ReactMouseEvent<HTMLElement>
      | ReactPointerEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
  };

  const stopUiPropagationAndDefault = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const stopTouchPointerDownPropagation = (event: ReactPointerEvent<HTMLElement>) => {
    preventTouchPointerCompatibilityMouseEvents(event);
    event.stopPropagation();
  };

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: CanvasFloatingToolbarButtonId,
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

  const handleButtonClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    buttonId: CanvasFloatingToolbarButtonId,
  ) => {
    event.stopPropagation();

    if (event.detail !== 0) {
      return;
    }

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: buttonId,
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  };

  return (
    <>
      {buttonIds.map((buttonId) => {
        const definition = CANVAS_FLOATING_TOOLBAR_DEFINITIONS[buttonId];
        const label = definition.label[locale];

        return (
          <button
            aria-label={label}
            className={cm(styles, joinClassNames([
              buttonClassName,
              definition.tone ? `is-${definition.tone}` : undefined,
            ]))}
            data-ui-button-id={buttonId}
            key={buttonId}
            onAuxClick={stopUiPropagationAndDefault}
            onClick={(event) => {
              handleButtonClick(event, buttonId);
            }}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopTouchPointerDownPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, buttonId);
            }}
            title={label}
            type="button"
          >
            <WorkbenchIcon className={cm(styles, iconClassName)} kind={definition.icon} />
            {showLabels ? (
              <span className={cm(styles, labelClassName)}>{label}</span>
            ) : (
              <span className={cm(styles, "sr-only")}>{label}</span>
            )}
          </button>
        );
      })}
    </>
  );
}
