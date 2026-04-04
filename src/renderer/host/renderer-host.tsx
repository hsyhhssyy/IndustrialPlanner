import { useEffect, useRef } from "react";
import { createPixiRendererRuntime } from "@/renderer/host/pixi-renderer-runtime";
import type { PixiRendererRuntime } from "@/renderer/host/pixi-renderer-runtime";
import {
  createRenderSceneCoordinator,
  type RenderSceneCoordinator,
  type RenderSceneCoordinatorSource,
} from "@/renderer/host/render-scene-coordinator";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";

export interface RendererHostProps {
  sceneSource: RenderSceneCoordinatorSource;
  placementPreviewProfiler?: PlacementPreviewProfiler;
}

export function RendererHost({
  sceneSource,
  placementPreviewProfiler,
}: RendererHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRuntimeRef = useRef<PixiRendererRuntime | null>(null);
  const coordinatorRef = useRef<RenderSceneCoordinator | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const rendererRuntime = createPixiRendererRuntime(hostRef.current, {
      placementPreviewProfiler,
    });
    const coordinator = createRenderSceneCoordinator({
      source: sceneSource,
      presentScene: (scene) => {
        rendererRuntime.syncScene(scene);
      },
      placementPreviewProfiler,
    });

    rendererRuntimeRef.current = rendererRuntime;
    coordinatorRef.current = coordinator;

    return () => {
      coordinatorRef.current?.dispose();
      coordinatorRef.current = null;
      rendererRuntimeRef.current = null;
      rendererRuntime.destroy();
    };
  }, [placementPreviewProfiler, sceneSource]);

  return (
    <div className="renderer-host" ref={hostRef} />
  );
}
