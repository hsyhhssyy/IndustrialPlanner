import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { WorldDocument } from "@/domain/document/world-document";
import type { SceneOverlay, ScenePresentationSettings } from "@/domain/document/scene-view-input";
import type { GridRect } from "@/domain/shared/grid";
import type { AppHost } from "../host";
import { createReadonlyCanvasScene } from "./readonly-canvas-scene";
import { mountCanvasSceneView } from "./scene-view-mount";

export function useReadonlyCanvas(options: {
  readonly appHost: AppHost;
  readonly container: RefObject<HTMLDivElement | null>;
  readonly document: WorldDocument | null;
  readonly bounds?: GridRect;
  readonly overlay?: SceneOverlay | null;
  readonly settings?: Partial<ScenePresentationSettings>;
  readonly enabled?: boolean;
  readonly onReady?: (canvas: HTMLCanvasElement) => void;
}) {
  const id = useId();
  const latest = useRef(options);
  latest.current = options;
  const owner = useRef<ReturnType<typeof createReadonlyCanvasScene> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const settingsKey = JSON.stringify(options.settings ?? {});
  const enabled = options.enabled !== false && options.document !== null;
  const renderer = options.appHost.workspace.render;

  useEffect(() => {
    const current = latest.current;
    const element = current.container.current;
    if (!enabled || current.document === null || renderer === null || element === null) return;
    const scene = createReadonlyCanvasScene({ ...current, id, document: current.document });
    owner.current = scene;
    const abort = new AbortController();
    let binding: Awaited<ReturnType<typeof mountCanvasSceneView>> | null = null;
    let mounting = false;
    setReady(false); setError(null);
    const measure = (): void => {
      if (abort.signal.aborted) return;
      const rect = element.getBoundingClientRect();
      scene.resize({ left: rect.left, top: rect.top, width: element.clientWidth, height: element.clientHeight });
      if (mounting || rect.width <= 0 || rect.height <= 0) return;
      mounting = true;
      void mountCanvasSceneView({ renderer, input: scene.input, time: { kind: "fixed", sampleTimeMs: 0 }, signal: abort.signal })
        .then((result) => {
          if (abort.signal.aborted) { result.dispose(); return; }
          binding = result;
          if (result.container !== null) element.replaceChildren(result.container);
          if (result.canvas !== null) {
            result.canvas.ariaHidden = "true";
            result.canvas.style.touchAction = "pan-y";
            latest.current.onReady?.(result.canvas);
          }
          setReady(true);
        }).catch((failure: unknown) => {
          if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
        });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    element.addEventListener("pointerdown", measure, true);
    measure();
    return () => {
      abort.abort(); observer.disconnect();
      window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure);
      element.removeEventListener("pointerdown", measure, true);
      binding?.dispose(); scene.dispose();
      if (owner.current === scene) owner.current = null;
      element.replaceChildren();
    };
  }, [id, renderer, enabled, settingsKey]);

  useEffect(() => {
    if (options.document !== null) owner.current?.replace(options.document, options.bounds, options.overlay);
  }, [options.document, options.bounds, options.overlay]);
  return { error, ready, get view() { return owner.current?.view ?? null; } };
}
