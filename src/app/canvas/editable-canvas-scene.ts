import { comparer, reaction } from "mobx";
import type { EditableSceneSession } from "@/domain/document/scene-session";
import type { SceneOverlay, SceneViewInput } from "@/domain/document/scene-view-input";
import { unionSceneBounds } from "@/shared/geometry/scene-space";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import type { AppHost } from "../host";
import { attachCanvasInput } from "../input";
import { CanvasInteractionController, type PlacementPaletteEntry } from "./canvas-interaction-controller";
import { createScenePresentation } from "./scene-presentation";

/** 独立相机和输入绑定现有会话；卸载视图保留任务文档及其历史。 */
export function createEditableCanvasScene<TIntent>(options: {
  readonly appHost: AppHost;
  readonly session: EditableSceneSession<TIntent>;
  readonly readPalette: () => readonly PlacementPaletteEntry[];
  readonly readOverlay: () => SceneOverlay | null;
  readonly preparePlacement?: () => Promise<void>;
}) {
  const { appHost, session } = options;
  const bounds = unionSceneBounds(session.source.snapshot.getSnapshot().space.areas.map(area => area.bounds))
    ?? { minX: null, maxX: null, minY: null, maxY: null };
  const view = appHost.sceneFactories.createView({ id: session.source.id + ":canvas",
    initialViewport: { center: { x: 15, y: 10 }, gridSize: 1, displayRotation: 0 },
    bounds: { kind: "space", bounds, padding: 10 },
    getOperationAvailability: operation => session.editor.queries.getOperationAvailability(operation),
  });
  const canvas = new CanvasInteractionController({ view, registry: session.source.registry,
    readEditor: () => session.editor, readWorkbench: () => appHost, readPalette: options.readPalette,
    preparePlacement: options.preparePlacement });
  const releaseInput = attachCanvasInput(canvas);
  const presentation = createScenePresentation({ app: appHost, showBaseBoundary: true,
    readTools: () => ({ activeTool: canvas.state.activeTool, moveKind: canvas.state.moveKind, toolInfo: canvas.state.toolInfo }),
    // 蓝图样式只固定设备绘制风格，名称等画布显示设置仍从工作台实时投影。
    settings: { gameUseBlueprintStyleDeviceImages: true, gamePlayDeviceAnimations: false,
      gameShowDeviceIcons: true, showGrassBackground: false, showRegionAnnotations: false, regionalMultiBaseEnabled: false },
  });
  const overlay = createSnapshotStore(options.readOverlay());
  const stopOverlay = reaction(options.readOverlay, value => overlay.setSnapshot(value), { equals: comparer.structural });
  const input: SceneViewInput = { id: view.id, source: session.source, camera: view,
    presentation: presentation.snapshot, simulation: null, overlay };
  const scene = { input, time: { kind: "advancing" as const, clockId: view.id + ":visual", initialTimeMs: 0 } };
  let disposed = false;
  return { canvas, scene, dispose(): void {
    if (disposed) return;
    disposed = true;
    releaseInput(); stopOverlay(); presentation.dispose(); view.dispose();
  } };
}
