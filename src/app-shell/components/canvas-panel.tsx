import type { WorkbenchController } from "@/app-shell/contracts/workbench-facade";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import { RendererHost } from "@/renderer/host/renderer-host";
import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

export interface CanvasPanelProps {
  controller: WorkbenchController;
}

export function CanvasPanel({ controller }: CanvasPanelProps) {
  const renderScene = useExternalStore(controller.renderSceneStore);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ x: number; y: number } | null>(null);
  const keyStateRef = useRef({ up: false, down: false, left: false, right: false });
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const stageElement = stageRef.current;

    if (!stageElement) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      controller.setCanvasViewportSize({
        x: entry.contentRect.width,
        y: entry.contentRect.height,
      });
    });

    resizeObserver.observe(stageElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [controller]);

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const dragState = dragStateRef.current;

      if (!dragState) {
        return;
      }

      const nextPointer = { x: event.clientX, y: event.clientY };

      controller.panCanvasBy({
        x: nextPointer.x - dragState.x,
        y: nextPointer.y - dragState.y,
      });

      dragStateRef.current = nextPointer;
    };

    const stopDragging = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDragging);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, [controller]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const startKeyboardPanLoop = () => {
    if (frameRef.current !== null) {
      return;
    }

    const tick = () => {
      const keyState = keyStateRef.current;
      const screenDelta = {
        x: (keyState.left ? -14 : 0) + (keyState.right ? 14 : 0),
        y: (keyState.up ? -14 : 0) + (keyState.down ? 14 : 0),
      };

      if (screenDelta.x === 0 && screenDelta.y === 0) {
        frameRef.current = null;
        return;
      }

      controller.panCanvasBy(screenDelta);
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
  };

  const stopKeyboardPanLoop = () => {
    keyStateRef.current = { up: false, down: false, left: false, right: false };

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    stageRef.current?.focus();

    const bounds = event.currentTarget.getBoundingClientRect();

    void controller.handleCanvasClick({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    stageRef.current?.focus();

    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key.toLowerCase()) {
      case "w":
        keyStateRef.current.up = true;
        break;
      case "a":
        keyStateRef.current.left = true;
        break;
      case "s":
        keyStateRef.current.down = true;
        break;
      case "d":
        keyStateRef.current.right = true;
        break;
      default:
        return;
    }

    event.preventDefault();
    startKeyboardPanLoop();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key.toLowerCase()) {
      case "w":
        keyStateRef.current.up = false;
        break;
      case "a":
        keyStateRef.current.left = false;
        break;
      case "s":
        keyStateRef.current.down = false;
        break;
      case "d":
        keyStateRef.current.right = false;
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  return (
    <main className="canvas-panel panel-surface">
      <div
        className="canvas-stage"
        onBlur={stopKeyboardPanLoop}
        onClick={handleCanvasClick}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onMouseDown={handleMouseDown}
        ref={stageRef}
        tabIndex={0}
      >
        <div
          className="canvas-viewport-surface"
          onClick={handleCanvasClick}
          onMouseDown={handleMouseDown}
        >
          <RendererHost scene={renderScene} />
        </div>
      </div>
    </main>
  );
}
