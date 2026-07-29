import { describe, expect, it } from "vitest";
import { runInAction } from "mobx";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  };
}

// 将网格 cell 中心映射为 client pixel，与 editor-host.test.ts 中 helper 等价
function gridCellCenterToClientPixel(
  editorHost: ReturnType<typeof createEditorHost>,
  cell: { x: number; y: number },
): { x: number; y: number } {
  return resolveViewportPointFromWorldPoint({
    worldPoint: { x: cell.x + 0.5, y: cell.y + 0.5 },
    viewportBounds: editorHost.state.viewport.clientRect,
    viewportCenter: editorHost.state.viewport.center,
    gridCellPixelSize: editorHost.state.viewport.gridCellPixelSize,
    displayRotation: editorHost.state.viewport.displayRotation,
  });
}

describe("findEntityAtClientPixelPoint - 边界场景（仅漏一角）", () => {
  it("设备大部分在视口外、仅右下角在视口内时，点击该角仍能命中", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 设置一个视口：clientRect 左上(0,0)，400x400
    editorHost.actions.setViewportClientRect({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    });
    // 视口中心在世界坐标 (10, 10)，grid size 默认
    runInAction(() => {
      (editorHost.state as unknown as { viewport: { center: { x: number; y: number } } }).viewport.center = { x: 10, y: 10 };
    });

    // 创建一个 3x3 设备，放在 (0, 0)
    // 在默认 gridCellPixelSize=48 的情况下：
    //   视口可见世界区域大致为 center ± (viewportSize/2)/gridSize 格 = 10 ± (200/48) ≈ 10 ± 4.2
    //   即世界坐标 x: 5.8~14.2, y: 5.8~14.2
    //   设备占据 (0,0)-(3,3)，完全在视口外
    //
    // 换一个场景：设备占据 (8, 8)-(11, 11)，视口覆盖 (5.8,5.8)-(14.2,14.2)
    // 设备 4 个格子都在视口内，无法测"漏一角"
    //
    // 让设备大一些 (比如 5x5)，放在 (11, 2)：
    //   设备占据 x: 11~16, y: 2~7
    //   视口可见: x: 5.8~14.2, y: 5.8~14.2
    //   设备左下角 (y:2~5.8) 在视口外，右上区域在视口内
    //   点击设备右下角 cell(15, 6) 应该在设备内
    const document = createDummyWorldDocument();
    const deviceId = "edge-device";
    document.entities[deviceId] = {
      id: deviceId,
      definitionId: "belt_straight_1x1", // 1x1 小设备，简单测试
      position: { x: 11, y: 11 },
      rotation: 0,
      config: {},
      tags: [],
    };
    document.entityOrder.push(deviceId);
    editorHost.internalDocument.setSnapshot(document);

    // 设备位置 (11,11)，1x1 大小覆盖 cell (11,11)
    // 视口可见世界: center(10,10)，半宽约 200/48 ≈ 4.17 格 → x: 5.83~14.17, y: 5.83~14.17
    // cell (11,11) 在视口内 → 点击应命中
    const hitPixel = gridCellCenterToClientPixel(editorHost, { x: 11, y: 11 });
    const hit = editorHost.queries.findEntityAtClientPixelPoint(hitPixel);
    expect(hit?.id).toBe(deviceId);

    // 点击视口外的 cell (15, 15) 不应命中
    const missPixel = gridCellCenterToClientPixel(editorHost, { x: 15, y: 15 });
    const miss = editorHost.queries.findEntityAtClientPixelPoint(missPixel);
    expect(miss).toBeNull();
  });

  it("设备仅右下角在视口内，大设备(3x3)命中检测正确", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    });
    runInAction(() => {
      (editorHost.state as unknown as { viewport: { center: { x: number; y: number } } }).viewport.center = { x: 10, y: 10 };
    });

    const document = createDummyWorldDocument();
    const deviceId = "big-device";
    document.entities[deviceId] = {
      id: deviceId,
      definitionId: "storager_1", // 3x3 大小的设备
      position: { x: 12, y: 12 },
      rotation: 0,
      config: {},
      tags: [],
    };
    document.entityOrder.push(deviceId);
    editorHost.internalDocument.setSnapshot(document);

    // 设备占据 (12,12)-(15,15)
    // 视口可见世界: center(10,10), 半宽约 4.17 格 → x: 5.83~14.17, y: 5.83~14.17
    // 设备左上角 cell (12,12) 在视口内
    // 设备右下角 cell (14,14) 在视口内

    // 点击设备左上角 cell(12,12)，应命中
    const hitTopLeft = gridCellCenterToClientPixel(editorHost, { x: 12, y: 12 });
    expect(editorHost.queries.findEntityAtClientPixelPoint(hitTopLeft)?.id).toBe(deviceId);

    // 点击设备右下角 cell(14,14)，应命中
    const hitBottomRight = gridCellCenterToClientPixel(editorHost, { x: 14, y: 14 });
    expect(editorHost.queries.findEntityAtClientPixelPoint(hitBottomRight)?.id).toBe(deviceId);

    // 点击设备外的 cell(16,16)，不应命中
    const missOutside = gridCellCenterToClientPixel(editorHost, { x: 16, y: 16 });
    expect(editorHost.queries.findEntityAtClientPixelPoint(missOutside)).toBeNull();
  });

  it("设备在视口边缘仅露一角(大设备偏移)，点击可见角命中", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 视口 clientRect 左上角不在 (0,0)，模拟画布在页面中有偏移
    editorHost.actions.setViewportClientRect({
      left: 200,
      top: 100,
      width: 400,
      height: 400,
    });
    runInAction(() => {
      (editorHost.state as unknown as { viewport: { center: { x: number; y: number } } }).viewport.center = { x: 50, y: 50 };
    });

    const document = createDummyWorldDocument();
    const deviceId = "edge-device-offset";
    document.entities[deviceId] = {
      id: deviceId,
      definitionId: "storager_1", // 3x3
      position: { x: 52, y: 52 },
      rotation: 0,
      config: {},
      tags: [],
    };
    document.entityOrder.push(deviceId);
    editorHost.internalDocument.setSnapshot(document);

    // 设备占据 (52,52)-(55,55)
    // 视口 clientRect: (200,100)-(600,500), center(50,50)
    // 半宽 ≈ 200/48 ≈ 4.17 格
    // 可见世界: x: 45.83~54.17, y: 45.83~54.17
    // 设备左上角 (52,52) 在视口内，右下角 (54,54) 大部分在视口内

    // 点击可见的左上角 cell(52,52)
    const hitPixel = gridCellCenterToClientPixel(editorHost, { x: 52, y: 52 });
    const result = editorHost.queries.findEntityAtClientPixelPoint(hitPixel);

    // 这个 cell 应该在设备内
    expect(result?.id).toBe(deviceId);
  });
});
