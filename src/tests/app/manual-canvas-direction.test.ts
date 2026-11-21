import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { GridRotation } from "@/domain/shared/grid";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { createEditableCanvasScene } from "@/app/canvas";
import { manualBoundarySceneBounds } from "@/shared/geometry/manual-boundary-position";
import { rotateManualPoint } from "@/shared/geometry/manual-layout-transform";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import { rotateGridEdge, resolveGridEdgeDelta } from "@/shared/geometry/port";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import input from "../blueprint-planner/fixtures/environment-supply.json";

const directions = [
  { rotation: 0, edge: "SOUTH", delta: { x: 0, y: 1 }, bounds: { minX: 0, maxX: null, minY: null, maxY: 16 } },
  { rotation: 90, edge: "WEST", delta: { x: -1, y: 0 }, bounds: { minX: -16, maxX: null, minY: 0, maxY: null } },
  { rotation: 180, edge: "NORTH", delta: { x: 0, y: -1 }, bounds: { minX: null, maxX: 0, minY: -16, maxY: null } },
  { rotation: 270, edge: "EAST", delta: { x: 1, y: 0 }, bounds: { minX: null, maxX: 16, minY: null, maxY: 0 } },
] as const;

it.each(directions)("四向共享几何/$rotation：底边法向、端口方向与绝对空间使用同一屏幕坐标", ({ rotation, edge, delta, bounds }) => {
  const normal = rotateManualPoint({ x: 0, y: 1 }, rotation);
  // 格坐标按数值严格相等；180/270度的算术负零与零属于同一条格线。
  expect(normal.x === delta.x && normal.y === delta.y).toBe(true);
  expect(rotateGridEdge("SOUTH", rotation)).toBe(edge);
  expect(resolveGridEdgeDelta(edge)).toEqual(delta);
  const manual = { enabled: true, orientation: "fixed", boundary: { rotation, position: { base: 16, left: 0, right: null }, assignments: [] } } as unknown as NonNullable<BlueprintPlannerRequest["manualLayout"]>;
  const actualBounds = manualBoundarySceneBounds(manual);
  for (const key of ["minX", "maxX", "minY", "maxY"] as const) expect(actualBounds[key] === bounds[key]).toBe(true);
});

it.each(directions)("人工会话/$rotation：相机永不旋转，选边与单设备/EDA整体旋转互不改写", async ({ rotation, delta }) => {
  const { workspace, app } = createAppTestWorkspace();
  const planner = createBlueprintPlannerHost(workspace, { storage: null });
  let owner: ReturnType<typeof createEditableCanvasScene> | undefined;
  try {
    const request = input as BlueprintPlannerRequest, controller = app.blueprintPlannerDialog;
    await controller.open(request.plan); controller.updateOptions(request.options);
    const manual = controller.manual; manual.setEnabled(true); await manual.prepare(controller.getRequest());
    const session = manual.ensureSession(), node = manual.layout!.preparation.nodes.find(candidate => candidate.purpose === "production")!;
    manual.place(node, { x: 4, y: 4 });
    const before = structuredClone(session.snapshot.getSnapshot().document.entities[node.id]!);
    expect(before).toBeDefined();
    owner = createEditableCanvasScene({ appHost: app, session, readPalette: () => [], readOverlay: () => null });
    const view = owner.canvas.view;
    view.actions.setViewportClientRect({ left: 10, top: 20, width: 460, height: 240 });
    expect(manual.getOperationAvailability("rotate-viewport")).toEqual({ supported: false, enabled: false, reason: null });
    expect(manual.getOperationAvailability("rotate-placement").enabled).toBe(true);
    const project = (point: { x: number; y: number }) => resolveViewportPointFromWorldPoint({ viewportBounds: view.state.clientRect,
      viewportCenter: view.state.center, gridCellPixelSize: view.state.gridCellPixelSize, displayRotation: view.state.displayRotation, worldPoint: point });
    for (const orientation of ["fixed", "free"] as const) {
      manual.setOrientation(orientation); manual.setBoundaryRotation(rotation);
      expect(session.snapshot.getSnapshot().document.entities[node.id]).toEqual(before);
      for (const cameraRotation of [90, 180, 270, 0] as GridRotation[]) {
        view.actions.setViewportDisplayRotation(cameraRotation);
        expect(view.state.displayRotation).toBe(0);
        const center = project({ x: 0, y: 0 }), border = project(rotateManualPoint({ x: 0, y: 1 }, rotation));
        expect(border.x - center.x).toBeCloseTo(delta.x * view.state.gridCellPixelSize);
        expect(border.y - center.y).toBeCloseTo(delta.y * view.state.gridCellPixelSize);
      }
    }
    manual.rotate();
    expect(session.snapshot.getSnapshot().document.entities[node.id]!.rotation).toBe((before.rotation + 90) % 360);
    expect(manual.layout!.boundary.rotation).toBe(rotation);
    expect(view.state.displayRotation).toBe(0);
    manual.undo(); expect(session.snapshot.getSnapshot().document.entities[node.id]).toEqual(before);
    manual.redo(); expect(view.state.displayRotation).toBe(0);
    view.actions.zoom(1); view.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 20, y: 10 } });
    expect(view.state.displayRotation).toBe(0);
  } finally { owner?.dispose(); planner.dispose(); app.dispose(); }
});
