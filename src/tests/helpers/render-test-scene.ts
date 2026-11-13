import { createScenePresentation } from "@/app/canvas";
import type { SceneOverlay, SceneViewInput } from "@/domain/document/scene-view-input";
import { RenderResourceScope } from "@/renderer/texture";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createCanvasTestSession } from "./canvas-test-session";

/** Renderer 契约测试组合真实会话、相机与显示投影；不伪造业务主机。 */
export function createRenderTestScene(options: Parameters<typeof createCanvasTestSession>[0] = {}) {
  const test = createCanvasTestSession(options);
  const presentation = createScenePresentation({ app: test.app,
    readTools: () => ({ activeTool: test.canvas.state.activeTool, moveKind: test.canvas.state.moveKind, toolInfo: test.canvas.state.toolInfo }),
    showBaseBoundary: true });
  const overlay = createSnapshotStore<SceneOverlay | null>(null);
  const resources = new RenderResourceScope(() => {});
  const input: SceneViewInput = { id: "render-test", source: test.session.source, camera: test.view,
    presentation: presentation.snapshot, overlay, simulation: null };
  return { ...test, input, overlay, resources,
    dispose(): void { resources.dispose(); presentation.dispose(); test.dispose(); } };
}
