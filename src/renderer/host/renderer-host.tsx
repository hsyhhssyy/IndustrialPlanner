import {
  useEffect,
  useEffectEvent,
  useRef,
} from "react";
import { createPixiRendererRuntime } from "@/renderer/host/pixi-renderer-runtime";
import type { PixiRendererRuntime } from "@/renderer/host/pixi-renderer-runtime";
import type { RenderSceneModel } from "@/renderer/scene/types";

export interface RendererHostProps {
  scene: RenderSceneModel;
}

export function RendererHost({
  scene,
}: RendererHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRuntimeRef = useRef<PixiRendererRuntime | null>(null);

  const redraw = useEffectEvent(() => {
    rendererRuntimeRef.current?.syncScene(scene);
  });

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const rendererRuntime = createPixiRendererRuntime(hostRef.current);

    rendererRuntimeRef.current = rendererRuntime;

    return () => {
      rendererRuntimeRef.current = null;
      rendererRuntime.destroy();
    };
  }, []);

  useEffect(() => {
    redraw();
  }, [scene]);

  return (
    <div className="renderer-host" ref={hostRef} />
  );
}
