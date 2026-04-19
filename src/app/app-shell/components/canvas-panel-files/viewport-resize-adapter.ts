import type { EditorContract } from "@/domain/contract/editor-contract";
import { useEffect, type RefObject } from "react";

function resolveViewportPixelSize(element: HTMLDivElement) {
  return {
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
      const pixelSize = resolveViewportPixelSize(viewportSurface);

      if (
        pixelSize.width === editor.state.viewport.pixelSize.width &&
        pixelSize.height === editor.state.viewport.pixelSize.height
      ) {
        return;
      }

      editor.actions.setViewportPixelSize(pixelSize);
    });

    resizeObserver.observe(viewportSurface);

    return () => {
      resizeObserver.disconnect();
    };
  }, [editor, viewportSurfaceRef]);
}