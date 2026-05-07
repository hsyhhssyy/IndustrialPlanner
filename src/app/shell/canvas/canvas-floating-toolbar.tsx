import type { AppHost } from "@/app/host/app-host";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { CanvasFloatingToolbarButtonId } from "@/app/state/state-impl";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

type CanvasFloatingToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasFloatingToolbarTone = "cancel" | "confirm" | "delete" | "rotate";

interface CanvasFloatingToolbarDefinition {
  readonly ariaLabel: {
    readonly "zh-CN": string;
    readonly "en-US": string;
  };
  icon: CanvasFloatingToolbarIconKind;
  tone?: CanvasFloatingToolbarTone;
}

interface CanvasFloatingToolbarProps {
  appHost: AppHost;
  buttonIds: readonly CanvasFloatingToolbarButtonId[];
  anchor: ClientPixelPoint;
}

const CANVAS_FLOATING_TOOLBAR_DEFINITIONS: Record<CanvasFloatingToolbarButtonId, CanvasFloatingToolbarDefinition> = {
  "canvas-floating-toolbar-button-ok": {
    ariaLabel: {
      "zh-CN": "确认",
      "en-US": "Confirm",
    },
    icon: "confirm",
    tone: "confirm",
  },
  "canvas-floating-toolbar-button-cancel": {
    ariaLabel: {
      "zh-CN": "取消",
      "en-US": "Cancel",
    },
    icon: "cancel",
    tone: "cancel",
  },
  "canvas-floating-toolbar-button-rotate": {
    ariaLabel: {
      "zh-CN": "旋转",
      "en-US": "Rotate",
    },
    icon: "rotate",
    tone: "rotate",
  },
  "canvas-floating-toolbar-button-move": {
    ariaLabel: {
      "zh-CN": "移动",
      "en-US": "Move",
    },
    icon: "move",
  },
  "canvas-floating-toolbar-button-delete": {
    ariaLabel: {
      "zh-CN": "删除",
      "en-US": "Delete",
    },
    icon: "delete",
    tone: "delete",
  },
  "canvas-floating-toolbar-button-delete-many": {
    ariaLabel: {
      "zh-CN": "批量删除",
      "en-US": "Delete Many",
    },
    icon: "delete-sweep",
    tone: "delete",
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function CanvasFloatingToolbar({
  appHost,
  buttonIds,
  anchor,
}: CanvasFloatingToolbarProps) {
  const locale = appHost.state.settings.locale;
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (toolbar === null) {
      appHost.internalActions.setCanvasFloatingToolbarSize(null);
      return;
    }

    const measure = () => {
      const rect = toolbar.getBoundingClientRect();
      appHost.internalActions.setCanvasFloatingToolbarSize({
        width: rect.width,
        height: rect.height,
      });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(toolbar);

    return () => {
      resizeObserver.disconnect();
    };
  }, [appHost, buttonIds]);

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
    <div
      aria-label="canvas floating toolbar"
      className="canvas-floating-toolbar"
      onAuxClick={stopUiPropagationAndDefault}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerCancel={stopUiPropagation}
      onPointerDown={stopUiPropagation}
      onPointerMove={stopUiPropagation}
      onPointerUp={stopUiPropagation}
      onWheel={stopUiPropagationAndDefault}
      ref={toolbarRef}
      style={{
        left: `${anchor.x}px`,
        top: `${anchor.y}px`,
      }}
    >
      {buttonIds.map((buttonId) => {
        const definition = CANVAS_FLOATING_TOOLBAR_DEFINITIONS[buttonId];
        const ariaLabel = definition.ariaLabel[locale];

        return (
          <button
            aria-label={ariaLabel}
            className={joinClassNames([
              "canvas-floating-toolbar-button",
              definition.tone ? `is-${definition.tone}` : undefined,
            ])}
            data-ui-button-id={buttonId}
            key={buttonId}
            onClick={(event) => {
              handleButtonClick(event, buttonId);
            }}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopUiPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, buttonId);
            }}
            type="button"
          >
            <WorkbenchIcon className="canvas-floating-toolbar-icon" kind={definition.icon} />
            <span className="sr-only">{ariaLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
