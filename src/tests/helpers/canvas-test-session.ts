import { CanvasInteractionController } from "@/app/canvas";
import { createGestureAdapter, type GestureAdapterOptions } from "@/app/input/gesture/adapter";
import type { GestureActionContext } from "@/app/input/gesture/actions";
import type { AppHost } from "@/app/host/app-host";
import type { ActiveTool } from "@/domain/app";
import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EditorSessionPolicy } from "@/domain/editor/types/editor-session-types";
import type { GridRotation } from "@/domain/shared/grid";
import type { SceneSpace } from "@/domain/shared/scene-space";
import { createAppTestWorkspace } from "./app-test-workspace";

/** 真实工作台偏好 + 独立内存会话；业务主机、查询和动作均不替换。 */
export function createCanvasTestSession(options: {
  document?: WorldDocument;
  adapterOptions?: GestureAdapterOptions;
  activeTool?: ActiveTool;
  policy?: EditorSessionPolicy<null>;
  space?: SceneSpace;
  viewport?: { center: { x: number; y: number }; gridSize: number; displayRotation: GridRotation };
} = {}) {
  const { app, workspace } = createAppTestWorkspace();
  const policy: EditorSessionPolicy<null> = options.policy ?? {
    getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
    resolvePlacementAreaIds: (_entity, space) => space.areas.map(area => area.id), validateTransition: () => [],
  };
  const bounds = { minX: null, maxX: null, minY: null, maxY: null };
  const session = app.sceneFactories.createMemorySession({
    id: "test-session", initialDocument: options.document ?? createWorldDocument({ baseId: "draft_box" }),
    initialIntent: null, reduceIntent: value => value, policy,
    space: options.space ?? { areas: [{ id: "test-space", bounds, outerRing: { top: 0, right: 0, bottom: 0, left: 0 } }] },
  });
  const view = app.sceneFactories.createView({ id: "test-canvas",
    initialViewport: options.viewport ?? { center: { x: 0, y: 0 }, gridSize: 1, displayRotation: 0 },
    bounds: { kind: "space", bounds, padding: 0 }, getOperationAvailability: policy.getOperationAvailability });
  const canvas = new CanvasInteractionController({ view, registry: workspace.registry,
    readEditor: () => session.editor, readWorkbench: () => app, workbenchActions: true });
  canvas.state.activeTool = options.activeTool ?? "select";
  const adapter = createGestureAdapter(canvas, options.adapterOptions);
  canvas.attachGestureAdapter(adapter);
  const context: GestureActionContext<AppHost> = { canvas, workspace, appHost: app,
    keyboard: { pressedKeys: new Set(), lastCode: null, lastKey: null, lastKeyCode: null,
      modifiers: { alt: false, ctrl: false, meta: false, shift: false } } };
  return { app, workspace, session, editor: session.editor, view, canvas, adapter, context,
    dispose(): void { canvas.dispose(); view.dispose(); session.dispose(); app.dispose(); } };
}
