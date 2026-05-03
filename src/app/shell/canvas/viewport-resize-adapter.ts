import type { EditorContract } from "@/domain/contract/editor-contract";
import { useEffect, type RefObject } from "react";

function resolveViewportClientRect(element: HTMLDivElement) {
  const clientRect = element.getBoundingClientRect();

  return {
    left: clientRect.left,
    top: clientRect.top,
    width: Math.max(0, Math.floor(element.clientWidth)),
    height: Math.max(0, Math.floor(element.clientHeight)),
  };
}

export function useViewportResizeAdapter(options: {
  editor: EditorContract | null;
  viewportSurfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { editor, viewportSurfaceRef } = options;

  useEffect(() => {
    const viewportSurface = viewportSurfaceRef.current;

    if (!editor || !viewportSurface || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      const clientRect = resolveViewportClientRect(viewportSurface);

      if (
        clientRect.left === editor.state.viewport.clientRect.left &&
        clientRect.top === editor.state.viewport.clientRect.top &&
        clientRect.width === editor.state.viewport.clientRect.width &&
        clientRect.height === editor.state.viewport.clientRect.height
      ) {
        return;
      }

      editor.actions.setViewportClientRect(clientRect);
    });

    resizeObserver.observe(viewportSurface);

    return () => {
      resizeObserver.disconnect();
    };
  }, [editor, viewportSurfaceRef]);
}