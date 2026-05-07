import type { AppHost } from "@/app/host/app-host";
import { CanvasFloatingToolbarButtonStrip } from "@/app/shell/shared/canvas-floating-toolbar-button-strip";
import type { CanvasFloatingToolbarButtonId } from "@/app/state/state-impl";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";
import {
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

interface CanvasFloatingToolbarProps {
  appHost: AppHost;
  buttonIds: readonly CanvasFloatingToolbarButtonId[];
  anchor: ClientPixelPoint;
}

export function CanvasFloatingToolbar({
  appHost,
  buttonIds,
  anchor,
}: CanvasFloatingToolbarProps) {
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
      <CanvasFloatingToolbarButtonStrip
        appHost={appHost}
        buttonClassName="canvas-floating-toolbar-button"
        buttonIds={buttonIds}
        iconClassName="canvas-floating-toolbar-icon"
      />
    </div>
  );
}
