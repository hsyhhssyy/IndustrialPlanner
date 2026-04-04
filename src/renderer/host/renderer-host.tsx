import { useEffect, useRef } from "react";
import { createPixiRendererRuntime } from "@/renderer/host/pixi-renderer-runtime";
import type { PixiRendererRuntime } from "@/renderer/host/pixi-renderer-runtime";
import {
  createRenderSceneCoordinator,
  type RenderSceneCoordinator,
  type RenderSceneCoordinatorSource,
} from "@/renderer/host/render-scene-coordinator";

export interface RendererHostProps {
  sceneSource: RenderSceneCoordinatorSource;
}

export function RendererHost({
  sceneSource,
}: RendererHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRuntimeRef = useRef<PixiRendererRuntime | null>(null);
  const coordinatorRef = useRef<RenderSceneCoordinator | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const rendererRuntime = createPixiRendererRuntime(hostRef.current);
    const coordinator = createRenderSceneCoordinator({
      source: sceneSource,
      presentScene: (scene) => {
        rendererRuntime.syncScene(scene);
      },
    });

    rendererRuntimeRef.current = rendererRuntime;
    coordinatorRef.current = coordinator;

    return () => {
      coordinatorRef.current?.dispose();
      coordinatorRef.current = null;
      rendererRuntimeRef.current = null;
      rendererRuntime.destroy();
    };
  }, [sceneSource]);

  return (
    <div className="renderer-host" ref={hostRef} />
  );
}
