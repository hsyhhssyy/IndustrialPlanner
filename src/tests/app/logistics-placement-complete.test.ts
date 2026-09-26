// @vitest-environment jsdom

import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import type {
  GestureKeyboardEventLike,
  GesturePointerEventLike,
} from "@/app/input/gesture/adapter";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-09-14:
// Reason: 运行时手写朝向补偿已由文件升级取代。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: loadBlueprintFromFile
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// import { rotateGridRotation } from "@/shared/geometry/grid";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

/**
 * 物流布设模式完全测试集
 *
 * 该测试集中的用例全部由用户手工创建和提供。后续修改也必须由用户手工提供用例，
 * 自动创建的测试用例不能放在这里。
 *
 * 如果该测试集中的测试 failed，则说明当前物流布设模式有问题。请开发人员检查代码和逻辑，
 * 不要随意修改测试用例。
 */
describe("物流布设模式完全测试集", () => {
  let appHost: AppHost;
  let editorHost: EditorHost;
  let nextPointerId: number;

  beforeEach(async () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    const initialDocumentKey = editorHost.internalDocument.getSnapshot().documentKey;
    await waitForEditorInitialDocumentLoad(editorHost, initialDocumentKey);
    appHost = createAppHost(workspace);
    nextPointerId = 1;

    resetCanvasFromUserBlueprint(editorHost);
    editorHost.actions.setViewportClientRect({
      left: 100,
      top: 80,
      width: 1200,
      height: 800,
    });

    runInAction(() => {
      // AI-REMOVED 2026-09-10:
      // Reason: 操作模式总开关已废弃，不再保留关闭分支
      // Trigger: 用户要求彻底移除 hypergryphOperationMode。
      // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
      // Replacement: 测试状态不再需要模式字段
      // Risk: 历史 false 设置统一使用当前操作行为。
      // Human Review: Required
      //
      // Original code:
      // appHost.internalState.settings.hypergryphOperationMode = true;
      appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = true;
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = false;
    });

    enterBeltLogisticsPlacement(appHost);
    clickCell(appHost, editorHost, { x: 10, y: 2 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    rightClickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);

    expect(appHost.internalState.runtime.logisticsPlacement.phase).toBe("idle");
    expect(editorHost.queries.resolveLogisticsDraftState()).toBeNull();

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 10, y: 6 },
      rotation: 270,
    });
  });

  afterEach(() => {
    appHost.dispose();
    editorHost.dispose();
    localStorage.clear();
  });

  it("从 6,3 布设到 2,5 后生成两个顺时针弯道", async () => {
    clickCell(appHost, editorHost, { x: 6, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 2, y: 5 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 2, y: 5 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 6, y: 5 },
      rotation: 270,
    }, { soft: true });
    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 2, y: 5 },
      rotation: 0,
    }, { soft: true });
  });

  it("从 6,3 布设到 1,5 后在 2,5 生成桥接器", async () => {
    clickCell(appHost, editorHost, { x: 6, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 1, y: 5 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 1, y: 5 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 6, y: 5 },
      rotation: 270,
    }, { soft: true });
    expectEntityAt(editorHost, {
      definitionId: "log_connector",
      position: { x: 2, y: 5 },
    }, { soft: true });
  });

  it("连续放置时不会被起笔处端口干扰", async () => {
    // 第一段：从 (2,4) 到 (4,3)
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    // 第二段：从 (4,3) 续接到 (4,6)，不应被起笔处的端口方向干扰
    await moveToCell(appHost, editorHost, { x: 4, y: 6 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 6 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 4, y: 3 },
      rotation: 180,
    });
  });

  it("右键结束布设后从已有传送带端点重新起笔到(5,6)生成转角", async () => {
    // 第一段：从 (2,4) 到 (4,3)
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    // 右键结束布设
    rightClickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    expect(appHost.internalState.runtime.logisticsPlacement.phase).toBe("idle");

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 3 },
      rotation: 0,
    });

    // 第二段：从已有传送带的 (4,3) 起笔到 (5,6)，应生成转角
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 5, y: 6 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 5, y: 6 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 4, y: 3 },
      rotation: 180,
    });
  });

  it("右键结束布设后从已有传送带端点重新起笔纵穿生成桥接器", async () => {
    // 第一段：从 (2,4) 到 (4,3)
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    // 右键结束布设
    rightClickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    expect(appHost.internalState.runtime.logisticsPlacement.phase).toBe("idle");

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 3 },
      rotation: 0,
    });

    // 第二段：从已有传送带的 (4,2) 起笔纵穿到 (4,7)，(4,3) 应生成桥接器
    clickCell(appHost, editorHost, { x: 4, y: 2 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 7 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 7 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "log_connector",
      position: { x: 4, y: 3 },
    });
  });

  it("从物流桥 A 拉到物流桥 B 时绕开中间物流桥 M 且不产生堆叠", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_BRIDGE_CROSSING);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 11, y: 8 }, nextPointerId++);
    expect(editorHost.queries.resolveLogisticsDraftState()?.source).toMatchObject({
      type: "device-port",
      entityId: "bridge-a",
      portGroupId: "item_output_ew",
      portId: "out_e",
      outsideGridPoint: { x: 12, y: 8 },
    });

    await moveToCell(appHost, editorHost, { x: 11, y: 10 }, nextPointerId++);
    await waitForGestureFrame();

    const draftBeforeApply = editorHost.queries.resolveLogisticsDraftState();
    expect(draftBeforeApply?.cells.some((cell) =>
      cell.gridPoint.x === 11 && cell.gridPoint.y === 9
    )).toBe(false);
    expect(draftBeforeApply).toMatchObject({
      canApply: true,
      invalidReason: null,
    });

    clickCell(appHost, editorHost, { x: 11, y: 10 }, nextPointerId++);
    const entitiesAtMiddleBridge = Object.values(
      editorHost.document.getSnapshot().entities,
    ).filter((entity) => entity.position.x === 11 && entity.position.y === 9);
    expect(entitiesAtMiddleBridge).toEqual([
      expect.objectContaining({ id: "bridge-m", definitionId: "log_connector" }),
    ]);
  });

  it("从已有传送带端点续接时切换线序生成弯道", async () => {
    // 第一段：从 (2,4) 到 (4,3)
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    // 右键结束布设
    rightClickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    expect(appHost.internalState.runtime.logisticsPlacement.phase).toBe("idle");

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 3 },
      rotation: 0,
    });

    // 第二段：从已有传送带 (4,3) 起笔到 (5,6)
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 5, y: 6 }, nextPointerId++);
    // 按下 R 切换为先横后竖
    pressRouteOrderShortcut(appHost);
    // 原地点击完成布设
    clickCell(appHost, editorHost, { x: 5, y: 6 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 3 },
      rotation: 0,
    });
  });

  it("场景2-从5,3横先布设到2,4生成弯道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE2);
    enterBeltLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);

    clickCell(appHost, editorHost, { x: 5, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 2, y: 4 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 5, y: 3 },
      rotation: 270,
    });
    expectEntityAt(editorHost, {
      definitionId: "belt_turn_ccw_1x1",
      position: { x: 2, y: 3 },
      rotation: 90,
    });
  });

  it("就近原则A", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE3);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 6, y: 5 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "log_connector",
      position: { x: 5, y: 3 },
    });
  });

  it("就近原则B", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE3);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 6, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 5 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 5 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "log_connector",
      position: { x: 5, y: 5 },
    });
  });

  it("场景4-管道从7,6经9,6布设到9,5生成逆时针弯道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE4);
    enterPipeLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);

    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    expect.soft(appHost.internalState.runtime.logisticsPlacement).toMatchObject({
      kind: "pipe",
      phase: "drawing",
      isHoverPreview: false,
      lastPreviewGridPoint: { x: 7, y: 6 },
    });
    expect.soft(editorHost.queries.resolveLogisticsDraftState()?.source).toMatchObject({
      type: "device-port",
      entityId: "pipe_admission:2",
      portDirection: "output",
      outsideGridPoint: { x: 8, y: 6 },
    });

    await moveToCell(appHost, editorHost, { x: 9, y: 6 }, nextPointerId++);
    await waitForGestureFrame();
    expect.soft(appHost.internalState.runtime.logisticsPlacement).toMatchObject({
      phase: "drawing",
      lastPreviewGridPoint: { x: 9, y: 6 },
      headGridPoint: { x: 9, y: 6 },
    });
    expect.soft(editorHost.queries.resolveLogisticsDraftState()?.cells.map((cell) => ({
      position: cell.gridPoint,
      shape: cell.shape,
      rotation: cell.rotation,
    }))).toEqual([
      { position: { x: 8, y: 6 }, shape: "straight", rotation: 0 },
      { position: { x: 9, y: 6 }, shape: "straight", rotation: 0 },
    ]);

    await moveToCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    await waitForGestureFrame();

    const draftBeforeApply = editorHost.queries.resolveLogisticsDraftState();
    expect.soft(draftBeforeApply?.canApply).toBe(true);
    expect.soft(draftBeforeApply?.invalidReason).toBeNull();
    expect.soft(draftBeforeApply?.cells.map((cell) => ({
      position: cell.gridPoint,
      shape: cell.shape,
      rotation: cell.rotation,
    }))).toEqual([
      { position: { x: 8, y: 6 }, shape: "straight", rotation: 0 },
      { position: { x: 9, y: 6 }, shape: "turn-ccw", rotation: 270 },
      { position: { x: 9, y: 5 }, shape: "straight", rotation: 270 },
    ]);
    expect.soft(draftBeforeApply?.cells.find((cell) =>
      cell.gridPoint.x === 9 && cell.gridPoint.y === 6
    )).toMatchObject({
      shape: "turn-ccw",
      rotation: 270,
    });

    clickCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    expect.soft(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
      source: {
        type: "logistics-entity",
        gridPoint: { x: 9, y: 5 },
      },
    });

    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_ccw_1x1",
      position: { x: 9, y: 6 },
      rotation: 270,
    });
  });

  it("场景4-删除9,5的重叠传送带后可连接已有管道", async () => {
// AI-REMOVED 2026-09-14:
// Reason: 重叠层序变体也保存为完整、可独立加载的蓝图。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/scene-4-without-overlapping-belt.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
//     const blueprintWithoutOverlappingBelt = structuredClone(USER_PROVIDED_BLUEPRINT_SCENE4);
//     delete blueprintWithoutOverlappingBelt.entities["logistics-draft:belt:572:3"];
//     blueprintWithoutOverlappingBelt.entityOrder = blueprintWithoutOverlappingBelt.entityOrder.filter(
//       (entityId) => entityId !== "logistics-draft:belt:572:3",
//     );
    const blueprintWithoutOverlappingBelt = loadBlueprintFromFile("src/tests/fixtures/blueprints/logistics-placement-complete/scene-4-without-overlapping-belt.schema6.json");
    resetCanvasFromUserBlueprint(editorHost, blueprintWithoutOverlappingBelt);
    enterPipeLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);

    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 9, y: 6 }, nextPointerId++);
    await waitForGestureFrame();
    await moveToCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    await waitForGestureFrame();
    clickCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    expect.soft(editorHost.queries.resolveLogisticsDraftState()).toMatchObject({
      source: {
        type: "logistics-entity",
        gridPoint: { x: 9, y: 5 },
      },
    });

    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_ccw_1x1",
      position: { x: 9, y: 6 },
      rotation: 270,
    });
  });

  it("场景4-9,5的传送带位于管道命中层之上时仍应连接管道", async () => {
// AI-REMOVED 2026-09-14:
// Reason: 重叠层序变体也保存为完整、可独立加载的蓝图。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/scene-4-belt-on-top.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
//     const blueprintWithOverlappingBeltOnTop = structuredClone(USER_PROVIDED_BLUEPRINT_SCENE4);
//     blueprintWithOverlappingBeltOnTop.entityOrder = [
//       ...blueprintWithOverlappingBeltOnTop.entityOrder.filter(
//         (entityId) => entityId !== "logistics-draft:belt:572:3",
//       ),
//       "logistics-draft:belt:572:3",
//     ];
    const blueprintWithOverlappingBeltOnTop = loadBlueprintFromFile("src/tests/fixtures/blueprints/logistics-placement-complete/scene-4-belt-on-top.schema6.json");
    resetCanvasFromUserBlueprint(editorHost, blueprintWithOverlappingBeltOnTop);
    enterPipeLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);

    expect(editorHost.document.getSnapshot().entityOrder.at(-1)).toBe(
      "logistics-draft:belt:572:3",
    );
    expect(editorHost.queries.findLogisticsDraftEndpointAtGridPoint(
      { x: 9, y: 5 },
      "pipe",
    )).toMatchObject({
      type: "logistics-entity",
      entityId: "logistics-draft:pipe:584:3",
    });

    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 9, y: 6 }, nextPointerId++);
    await waitForGestureFrame();
    await moveToCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    await waitForGestureFrame();

    const draftBeforeApply = editorHost.queries.resolveLogisticsDraftState();
    expect(draftBeforeApply?.cells.find((cell) =>
      cell.gridPoint.x === 9 && cell.gridPoint.y === 6
    )).toMatchObject({
      shape: "turn-ccw",
      rotation: 270,
    });
    expect(draftBeforeApply).toMatchObject({
      canApply: true,
      invalidReason: null,
    });

    clickCell(appHost, editorHost, { x: 9, y: 5 }, nextPointerId++);
    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_ccw_1x1",
      position: { x: 9, y: 6 },
      rotation: 270,
    });
  });

  it("断头管道末端前一格起笔-空地起笔关闭时从5,4布设到6,4生成直管", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_DEADEND);

    // 关闭空地起笔，此时仅允许从设备端口或断头物流末端前一格起笔
    runInAction(() => {
      appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = false;
    });

    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 5, y: 4 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 6, y: 4 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 6, y: 4 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "pipe_straight_1x1",
      position: { x: 5, y: 4 },
      rotation: 0,
    });
  });

  it("反应池内侧端口(7,6)布设到(6,9)时自动选合法管道线序", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_ROUTE_PRIORITY_REACTOR_POOLS);
    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 6, y: 9 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 6, y: 9 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_cw_1x1",
      position: { x: 8, y: 8 },
      rotation: 270,
    });
  });

  it("反应池外侧端口(8,6)布设到(6,9)时自动选合法管道线序", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_ROUTE_PRIORITY_REACTOR_POOLS);
    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 8, y: 6 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 6, y: 9 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 6, y: 9 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "pipe_turn_cw_1x1",
      position: { x: 8, y: 8 },
      rotation: 270,
    });
  });

  it("管道从已有管道起笔分叉-开启自动分流器时穿过液燃炉应显示红色且拒绝落盘", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_BRANCH);
    runInAction(() => {
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = true;
    });
    enterPipeLogisticsPlacement(appHost);

    // (51,3) 起笔，向 (51,2) 移动（液燃炉方向）
    clickCell(appHost, editorHost, { x: 51, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 51, y: 2 }, nextPointerId++);
    const entitiesBeforeConfirm = editorHost.document.getSnapshot().entities;
    expect(editorHost.queries.resolveLogisticsDraftState()?.canApply).toBe(false);
    expect(editorHost.state.collections["preview"].some((entityId) =>
      editorHost.state.collections["invalid-placement"].includes(entityId)
    )).toBe(true);
    clickCell(appHost, editorHost, { x: 51, y: 2 }, nextPointerId++);
    expect(editorHost.document.getSnapshot().entities).toEqual(entitiesBeforeConfirm);

    // (51,3) 应生成 pipe_splitter
    // AI-CORRECTION 2026-09-24: 路线穿过液燃炉，占用格冲突；此处应预览红色且点击不得落盘。
    // AI-REMOVED 2026-09-24:
    // Reason: 原断言把穿越设备的红色无效路径当作可提交路径。
    // Trigger: 用户明确要求此用例改为确认红色。
    // Evidence: (51,2) 的预览格与液燃炉重叠，invalid-placement 非空，canApply=false。
    // Replacement: 本用例上方的预览与落盘断言。
    // Risk: Low。
    // Human Review: Required
    // Original code:
    // expectEntityAt(editorHost, {
    //   definitionId: "pipe_splitter",
    //   position: { x: 51, y: 3 },
    // });
  });

  it("管道从已有管道起笔分叉-关闭自动分流器时穿过液燃炉应显示红色且拒绝落盘", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_BRANCH);
    runInAction(() => {
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = false;
    });
    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 51, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 51, y: 2 }, nextPointerId++);
    const entitiesBeforeConfirm = editorHost.document.getSnapshot().entities;
    expect(editorHost.queries.resolveLogisticsDraftState()?.canApply).toBe(false);
    expect(editorHost.state.collections["preview"].some((entityId) =>
      editorHost.state.collections["invalid-placement"].includes(entityId)
    )).toBe(true);
    clickCell(appHost, editorHost, { x: 51, y: 2 }, nextPointerId++);
    expect(editorHost.document.getSnapshot().entities).toEqual(entitiesBeforeConfirm);

    // 关闭自动分流器时，(51,3) 应转为 pipe_turn_ccw_1x1 弯道
    // AI-CORRECTION 2026-09-24: 禁用自动分流器不改变设备占用规则；红色路线不得落盘。
    // AI-REMOVED 2026-09-24:
    // Reason: 原断言把穿越设备的红色无效路径当作可提交路径。
    // Trigger: 用户明确要求此用例改为确认红色。
    // Evidence: (51,2) 的预览格与液燃炉重叠，invalid-placement 非空，canApply=false。
    // Replacement: 本用例上方的预览与落盘断言。
    // Risk: Low。
    // Human Review: Required
    // Original code:
    // expectEntityAt(editorHost, {
    //   definitionId: "pipe_turn_ccw_1x1",
    //   position: { x: 51, y: 3 },
    //   rotation: 270,
    // });
  });

  it("连续布设管道绕回穿越已有直管时(2,2)应生成管道桥接器", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_PIPE_CONTINUOUS_CROSSING);
    runInAction(() => {
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = true;
    });
    enterPipeLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 2, y: 1 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 3, y: 1 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 3, y: 1 }, nextPointerId++);

    await moveToCell(appHost, editorHost, { x: 3, y: 2 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 1, y: 2 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 1, y: 2 }, nextPointerId++);
    rightClickCell(appHost, editorHost, { x: 1, y: 2 }, nextPointerId++);

    expect(appHost.internalState.runtime.logisticsPlacement.phase).toBe("idle");
    expectEntityAt(editorHost, {
      definitionId: "pipe_connector",
      position: { x: 2, y: 2 },
    });
  });

  it("被压制的管道不干扰传送带布设-从(2,3)到(4,3)生成直道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SUPPRESSION_OVERLAP);
    enterBeltLogisticsPlacement(appHost);
    // belt 模式下压制管道
    editorHost.actions.setLogisticsSuppression("pipe", true);

    clickCell(appHost, editorHost, { x: 2, y: 3 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 4, y: 3 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_straight_1x1",
      position: { x: 3, y: 3 },
      rotation: 0,
    });
  });

  it("场景2-从配件机8,5输出口布设到10,6生成逆时针弯道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE2);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 8, y: 5 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 10, y: 6 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 10, y: 6 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_ccw_1x1",
      position: { x: 7, y: 6 },
      rotation: 0,
    });
  });

  it("场景2-从液燃炉4,2输入口布设到3,0生成顺时针弯道", async () => {
    resetCanvasFromUserBlueprint(editorHost, USER_PROVIDED_BLUEPRINT_SCENE2);
    enterBeltLogisticsPlacement(appHost);

    clickCell(appHost, editorHost, { x: 4, y: 2 }, nextPointerId++);
    await moveToCell(appHost, editorHost, { x: 3, y: 0 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 3, y: 0 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 3, y: 3 },
      rotation: 0,
    });
  });

});


// AI-REMOVED 2026-09-14:
// Reason: 内联历史蓝图已迁移为独立 JSON 文件，保留原文用于审计。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/scene-1.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// const USER_PROVIDED_BLUEPRINT: BlueprintDocument = {
//   schemaVersion: 3,
//   blueprintId: "7d8dd13e-274d-47c3-9000-799df527c807",
//   version: "v1.3.0",
//   name: "1111",
//   description: "",
//   baseId: "wuling_protocol_core",
//   initialGridPoint: { x: 6, y: 5 },
//   entities: {
//     "item_port_liquid_furnance_1:2": {
//       id: "item_port_liquid_furnance_1:2",
//       definitionId: "furnance_1_liquid",
//       position: { x: 4, y: 0 },
//       rotation: 180,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:84:0": {
//       id: "logistics-draft:belt:84:0",
//       definitionId: "belt_straight_1x1",
//       position: { x: 6, y: 3 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:87:1": {
//       id: "logistics-draft:belt:87:1",
//       definitionId: "belt_turn_ccw_1x1",
//       position: { x: 6, y: 4 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:86:2": {
//       id: "logistics-draft:belt:86:2",
//       definitionId: "belt_straight_1x1",
//       position: { x: 7, y: 4 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:88:3": {
//       id: "logistics-draft:belt:88:3",
//       definitionId: "belt_straight_1x1",
//       position: { x: 8, y: 4 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:143:1": {
//       id: "logistics-draft:belt:143:1",
//       definitionId: "belt_straight_1x1",
//       position: { x: 2, y: 6 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:144:2": {
//       id: "logistics-draft:belt:144:2",
//       definitionId: "belt_straight_1x1",
//       position: { x: 2, y: 5 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:145:3": {
//       id: "logistics-draft:belt:145:3",
//       definitionId: "belt_straight_1x1",
//       position: { x: 2, y: 4 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:157:2": {
//       id: "logistics-draft:belt:157:2",
//       definitionId: "belt_straight_1x1",
//       position: { x: 3, y: 8 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:158:3": {
//       id: "logistics-draft:belt:158:3",
//       definitionId: "belt_straight_1x1",
//       position: { x: 4, y: 8 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//   },
//   entityOrder: [
//     "item_port_liquid_furnance_1:2",
//     "logistics-draft:belt:84:0",
//     "logistics-draft:belt:87:1",
//     "logistics-draft:belt:86:2",
//     "logistics-draft:belt:88:3",
//     "logistics-draft:belt:143:1",
//     "logistics-draft:belt:144:2",
//     "logistics-draft:belt:145:3",
//     "logistics-draft:belt:157:2",
//     "logistics-draft:belt:158:3",
//   ],
//   slotLinks: [],
//   regions: [],
//   createdAt: "2026-06-19T08:48:20.300Z",
//   updatedAt: "2026-06-19T08:48:20.300Z",
// };
const USER_PROVIDED_BLUEPRINT: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/scene-1.schema6.json",
);

// AI-REMOVED 2026-09-14:
// Reason: 内联历史蓝图已迁移为独立 JSON 文件，保留原文用于审计。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/scene-2.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// const USER_PROVIDED_BLUEPRINT_SCENE2: BlueprintDocument = {
//   schemaVersion: 3,
//   blueprintId: "41bf5dc4-f741-45af-850a-0e81b583e219",
//   version: "v1.3.0",
//   name: "场景2",
//   description: "",
//   baseId: "wuling_protocol_core",
//   initialGridPoint: { x: 7, y: 4 },
//   entities: {
//     "item_port_cmpt_mc_1:12": {
//       id: "item_port_cmpt_mc_1:12",
//       definitionId: "cmpt_mc_1",
//       position: { x: 8, y: 3 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "item_port_liquid_furnance_1:9": {
//       id: "item_port_liquid_furnance_1:9",
//       definitionId: "furnance_1_liquid",
//       position: { x: 4, y: 0 },
//       rotation: 180,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:414:0": {
//       id: "logistics-draft:belt:414:0",
//       definitionId: "belt_straight_1x1",
//       position: { x: 7, y: 3 },
//       rotation: 180,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:415:1": {
//       id: "logistics-draft:belt:415:1",
//       definitionId: "belt_straight_1x1",
//       position: { x: 6, y: 3 },
//       rotation: 180,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:416:2": {
//       id: "logistics-draft:belt:416:2",
//       definitionId: "belt_straight_1x1",
//       position: { x: 5, y: 3 },
//       rotation: 180,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:426:0": {
//       id: "logistics-draft:belt:426:0",
//       definitionId: "belt_straight_1x1",
//       position: { x: 2, y: 4 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:427:1": {
//       id: "logistics-draft:belt:427:1",
//       definitionId: "belt_straight_1x1",
//       position: { x: 2, y: 5 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:428:2": {
//       id: "logistics-draft:belt:428:2",
//       definitionId: "belt_straight_1x1",
//       position: { x: 2, y: 6 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:445:0": {
//       id: "logistics-draft:belt:445:0",
//       definitionId: "belt_straight_1x1",
//       position: { x: 7, y: 7 },
//       rotation: 180,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:446:1": {
//       id: "logistics-draft:belt:446:1",
//       definitionId: "belt_straight_1x1",
//       position: { x: 6, y: 7 },
//       rotation: 180,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:447:2": {
//       id: "logistics-draft:belt:447:2",
//       definitionId: "belt_straight_1x1",
//       position: { x: 5, y: 7 },
//       rotation: 180,
//       config: {},
//       tags: [],
//     },
//   },
//   entityOrder: [
//     "item_port_cmpt_mc_1:12",
//     "item_port_liquid_furnance_1:9",
//     "logistics-draft:belt:414:0",
//     "logistics-draft:belt:415:1",
//     "logistics-draft:belt:416:2",
//     "logistics-draft:belt:426:0",
//     "logistics-draft:belt:427:1",
//     "logistics-draft:belt:428:2",
//     "logistics-draft:belt:445:0",
//     "logistics-draft:belt:446:1",
//     "logistics-draft:belt:447:2",
//   ],
//   slotLinks: [],
//   regions: [],
//   createdAt: "2026-06-19T13:28:08.212Z",
//   updatedAt: "2026-06-19T13:28:08.212Z",
// };
const USER_PROVIDED_BLUEPRINT_SCENE2: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/scene-2.schema6.json",
);

// AI-REMOVED 2026-09-14:
// Reason: 内联历史蓝图已迁移为独立 JSON 文件，保留原文用于审计。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/scene-3.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// const USER_PROVIDED_BLUEPRINT_SCENE3: BlueprintDocument = {
//   schemaVersion: 3,
//   blueprintId: "1041aaaf-437b-435d-ad2b-2241bb520fbe",
//   version: "v1.3.0",
//   name: "场景3",
//   description: "",
//   baseId: "wuling_protocol_core",
//   initialGridPoint: { x: 6, y: 5 },
//   entities: {
//     "item_port_cmpt_mc_1:9": {
//       id: "item_port_cmpt_mc_1:9",
//       definitionId: "cmpt_mc_1",
//       position: { x: 2, y: 3 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "item_port_cmpt_mc_1:11": {
//       id: "item_port_cmpt_mc_1:11",
//       definitionId: "cmpt_mc_1",
//       position: { x: 6, y: 3 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:580:1": {
//       id: "logistics-draft:belt:580:1",
//       definitionId: "belt_straight_1x1",
//       position: { x: 5, y: 5 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:581:2": {
//       id: "logistics-draft:belt:581:2",
//       definitionId: "belt_straight_1x1",
//       position: { x: 5, y: 4 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:582:3": {
//       id: "logistics-draft:belt:582:3",
//       definitionId: "belt_straight_1x1",
//       position: { x: 5, y: 3 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//   },
//   entityOrder: [
//     "item_port_cmpt_mc_1:9",
//     "item_port_cmpt_mc_1:11",
//     "logistics-draft:belt:580:1",
//     "logistics-draft:belt:581:2",
//     "logistics-draft:belt:582:3",
//   ],
//   slotLinks: [],
//   regions: [],
//   createdAt: "2026-06-19T13:36:00.575Z",
//   updatedAt: "2026-06-19T13:36:00.575Z",
// };
const USER_PROVIDED_BLUEPRINT_SCENE3: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/scene-3.schema6.json",
);

// AI-REMOVED 2026-09-14:
// Reason: 内联历史蓝图已迁移为独立 JSON 文件，保留原文用于审计。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/scene-4.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// const USER_PROVIDED_BLUEPRINT_SCENE4: BlueprintDocument = {
//   schemaVersion: 3,
//   blueprintId: "37c8e4e6-c720-4480-95bf-f584d2d257aa",
//   version: "v1.3.0",
//   name: "未命名蓝图-20260722212625",
//   description: "",
//   baseId: "wuling_tianwangping_aid",
//   initialGridPoint: { x: 9, y: 6 },
//   entities: {
//     "pipe_admission:2": {
//       id: "pipe_admission:2",
//       definitionId: "pipe_admission",
//       position: { x: 7, y: 6 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:571:2": {
//       id: "logistics-draft:belt:571:2",
//       definitionId: "belt_straight_1x1",
//       position: { x: 8, y: 5 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:572:3": {
//       id: "logistics-draft:belt:572:3",
//       definitionId: "belt_straight_1x1",
//       position: { x: 9, y: 5 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:belt:573:4": {
//       id: "logistics-draft:belt:573:4",
//       definitionId: "belt_straight_1x1",
//       position: { x: 10, y: 5 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:pipe:584:3": {
//       id: "logistics-draft:pipe:584:3",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 9, y: 5 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//   },
//   entityOrder: [
//     "pipe_admission:2",
//     "logistics-draft:belt:571:2",
//     "logistics-draft:belt:572:3",
//     "logistics-draft:belt:573:4",
//     "logistics-draft:pipe:584:3",
//   ],
//   slotLinks: [],
//   regions: [],
//   createdAt: "2026-07-22T13:26:26.853Z",
//   updatedAt: "2026-07-22T13:26:26.853Z",
// };
const USER_PROVIDED_BLUEPRINT_SCENE4: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/scene-4.schema6.json",
);

const USER_PROVIDED_BLUEPRINT_BRIDGE_CROSSING: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/bridge-crossing.schema6.json",
);

// AI-REMOVED 2026-09-14:
// Reason: 内联历史蓝图已迁移为独立 JSON 文件，保留原文用于审计。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/pipe-deadend.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// const USER_PROVIDED_BLUEPRINT_PIPE_DEADEND: BlueprintDocument = {
//   schemaVersion: 3,
//   blueprintId: "833b49ea-c832-470f-be0b-043b16890b8f",
//   version: "v1.3.0",
//   name: "未命名蓝图-20260723105623",
//   description: "",
//   baseId: "stm_hongs_3",
//   initialGridPoint: { x: 4, y: 3 },
//   entities: {
//     "logistics-draft:pipe:1:0": {
//       id: "logistics-draft:pipe:1:0",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 3, y: 4 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "pipe_splitter:1": {
//       id: "pipe_splitter:1",
//       definitionId: "pipe_splitter",
//       position: { x: 5, y: 1 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "pipe_splitter:2": {
//       id: "pipe_splitter:2",
//       definitionId: "pipe_splitter",
//       position: { x: 2, y: 4 },
//       rotation: 270,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:pipe:2:1": {
//       id: "logistics-draft:pipe:2:1",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 4, y: 4 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:pipe:5:0": {
//       id: "logistics-draft:pipe:5:0",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 5, y: 2 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//     "logistics-draft:pipe:6:1": {
//       id: "logistics-draft:pipe:6:1",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 5, y: 3 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//   },
//   entityOrder: [
//     "logistics-draft:pipe:1:0",
//     "pipe_splitter:1",
//     "pipe_splitter:2",
//     "logistics-draft:pipe:2:1",
//     "logistics-draft:pipe:5:0",
//     "logistics-draft:pipe:6:1",
//   ],
//   slotLinks: [],
//   regions: [],
//   createdAt: "2026-07-23T02:56:24.419Z",
//   updatedAt: "2026-07-23T02:56:24.419Z",
// };
const USER_PROVIDED_BLUEPRINT_PIPE_DEADEND: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/pipe-deadend.schema6.json",
);

// AI-REMOVED 2026-09-14:
// Reason: 内联历史蓝图已迁移为独立 JSON 文件，保留原文用于审计。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/pipe-branch.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// const USER_PROVIDED_BLUEPRINT_PIPE_BRANCH: BlueprintDocument = {
//   schemaVersion: 3,
//   blueprintId: "pipe-branch-test-001",
//   version: "v1.3.0",
//   name: "管道分叉测试",
//   description: "(50,0)液燃炉rotation=0, (50/51/52,3)三格管道",
//   baseId: "wuling_protocol_core",
//   initialGridPoint: { x: 51, y: 3 },
//   entities: {
//     "liquid-furnance": {
//       id: "liquid-furnance",
//       definitionId: "furnance_1_liquid",
//       position: { x: 50, y: 0 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "pipe-50-3": {
//       id: "pipe-50-3",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 50, y: 3 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "pipe-51-3": {
//       id: "pipe-51-3",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 51, y: 3 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "pipe-52-3": {
//       id: "pipe-52-3",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 52, y: 3 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//   },
//   entityOrder: ["liquid-furnance", "pipe-50-3", "pipe-51-3", "pipe-52-3"],
//   slotLinks: [],
//   regions: [],
//   createdAt: "2026-07-23T10:00:00.000Z",
//   updatedAt: "2026-07-23T10:00:00.000Z",
// };
const USER_PROVIDED_BLUEPRINT_PIPE_BRANCH: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/pipe-branch.schema6.json",
);

// AI-REMOVED 2026-09-14:
// Reason: 内联历史蓝图已迁移为独立 JSON 文件，保留原文用于审计。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/pipe-continuous-crossing.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// const USER_PROVIDED_BLUEPRINT_PIPE_CONTINUOUS_CROSSING: BlueprintDocument = {
//   schemaVersion: 5,
//   blueprintId: "16247ed5-4276-4419-a608-9856720b46e4",
//   version: "",
//   name: "未命名蓝图-20260913230402",
//   description: "",
//   baseId: "wuling_tianwangping_aid",
//   initialGridPoint: { x: 3, y: 3 },
//   entities: {
//     "pipe_splitter:5": {
//       id: "pipe_splitter:5",
//       definitionId: "pipe_splitter",
//       position: { x: 2, y: 1 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "pipe_straight_1x1:5": {
//       id: "pipe_straight_1x1:5",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 2, y: 2 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//     "pipe_straight_1x1:6": {
//       id: "pipe_straight_1x1:6",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 2, y: 3 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//     "pipe_straight_1x1:7": {
//       id: "pipe_straight_1x1:7",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 2, y: 4 },
//       rotation: 90,
//       config: {},
//       tags: [],
//     },
//   },
//   entityOrder: [
//     "pipe_splitter:5",
//     "pipe_straight_1x1:5",
//     "pipe_straight_1x1:6",
//     "pipe_straight_1x1:7",
//   ],
//   slotLinks: [],
//   regions: [],
//   createdAt: "2026-09-13T15:04:03.139Z",
//   updatedAt: "2026-09-13T15:04:03.139Z",
// };
const USER_PROVIDED_BLUEPRINT_PIPE_CONTINUOUS_CROSSING: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/pipe-continuous-crossing.schema6.json",
);

const USER_PROVIDED_BLUEPRINT_PIPE_ROUTE_PRIORITY_REACTOR_POOLS: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/pipe-route-priority-reactor-pools.schema6.json",
);

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
    audio: null,
    blueprintPlanner: null,
  };
}

async function waitForEditorInitialDocumentLoad(
  editorHost: EditorHost,
  initialDocumentKey: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (editorHost.internalDocument.getSnapshot().documentKey !== initialDocumentKey) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("等待 editor 初始文档加载超时");
}

async function waitForGestureFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function resetCanvasFromUserBlueprint(
  editorHost: EditorHost,
  blueprint: BlueprintDocument = USER_PROVIDED_BLUEPRINT,
): void {
  const emptyDocument = createWorldDocument({
    baseId: blueprint.baseId,
  });
  editorHost.internalDocument.setSnapshot(emptyDocument);

  const entities = structuredClone(blueprint.entities);
// AI-REMOVED 2026-09-14:
// Reason: 已加载 schema 6 蓝图，删除仅覆盖两台设备的运行时旋转名单。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
//   // AI-CORRECTION 2026-09-11: these user-provided schema-3 fixtures encode
//   // the pre-AKEData-1.5.3 registry orientation. Translate only affected
//   // device entities so their recorded world connections remain unchanged;
//   // belt and pipe fixtures remain byte-for-byte equivalent.
//   const correctedOrientationIds = new Set([
//     "cmpt_mc_1",
//     "furnance_1_liquid",
//   ]);
//   for (const entity of Object.values(entities)) {
//     if (correctedOrientationIds.has(entity.definitionId)) {
//       entity.rotation = rotateGridRotation(entity.rotation, 180);
//     }
//   }
  const blueprintDocument: WorldDocument = {
    ...emptyDocument,
    entities,
    entityOrder: [...blueprint.entityOrder],
    slotLinks: structuredClone(blueprint.slotLinks),
    documentSettings: {
      ...emptyDocument.documentSettings,
      viewport: {
        center: { ...blueprint.initialGridPoint },
        gridSize: emptyDocument.documentSettings.viewport.gridSize,
        displayRotation: 0,
      },
    },
  };
  editorHost.internalDocument.setSnapshot(blueprintDocument);
}

function enterBeltLogisticsPlacement(appHost: AppHost): void {
  runInAction(() => {
    const runtime = appHost.internalState.runtime.logisticsPlacement;
    runtime.kind = "belt";
    runtime.shortcutPlacementGroup = "beltLogistics";
    runtime.pointerMode = "mouse";
    runtime.phase = "idle";
    runtime.routeOrder = "vertical-first";
    appHost.internalState.runtime.selectingPlacementGroup = "beltLogistics";
  });
  appHost.internalActions.setActiveTool("logistics-placement");
}

function enterPipeLogisticsPlacement(appHost: AppHost): void {
  runInAction(() => {
    const runtime = appHost.internalState.runtime.logisticsPlacement;
    runtime.kind = "pipe";
    runtime.shortcutPlacementGroup = "pipeLogistics";
    runtime.pointerMode = "mouse";
    runtime.phase = "idle";
    runtime.routeOrder = "vertical-first";
    appHost.internalState.runtime.selectingPlacementGroup = "pipeLogistics";
  });
  appHost.internalActions.setActiveTool("logistics-placement");
  appHost.gestureAdapter.handleUiButtonMouseTap({
    uiButtonId: "placement-action-pipe-draw",
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  });
}

function pressRouteOrderShortcut(appHost: AppHost): void {
  appHost.gestureAdapter.handleKeyDown(keyEvent({
    code: "KeyR",
    key: "r",
    keyCode: 82,
  }));
}

const pointerGridPointByAppHost = new WeakMap<
  AppHost,
  { readonly x: number; readonly y: number }
>();

function clickCell(
  appHost: AppHost,
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
  pointerId: number,
): void {
  const point = resolveClientPixelPointForGridCell(editorHost, cell);
  appHost.gestureAdapter.handlePointerDown(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    buttons: 1,
  }));
  appHost.gestureAdapter.handlePointerUp(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    buttons: 0,
  }));
  pointerGridPointByAppHost.set(appHost, cell);
}

function rightClickCell(
  appHost: AppHost,
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
  pointerId: number,
): void {
  const point = resolveClientPixelPointForGridCell(editorHost, cell);
  appHost.gestureAdapter.handlePointerDown(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    button: 2,
    buttons: 2,
  }));
  appHost.gestureAdapter.handlePointerUp(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    button: 2,
    buttons: 0,
  }));
  pointerGridPointByAppHost.set(appHost, cell);
}

async function moveToCell(
  appHost: AppHost,
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
  pointerId: number,
): Promise<void> {
  const startCell = pointerGridPointByAppHost.get(appHost);
  if (startCell === undefined) {
    throw new Error("平滑移动前必须先通过测试夹具定位指针起点");
  }

  await waitForGestureFrame();
  for (const pathCell of resolveGridCellCenterPath(startCell, cell)) {
    const point = resolveClientPixelPointForGridCell(editorHost, pathCell);
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId,
      clientX: point.x,
      clientY: point.y,
      button: -1,
      buttons: 0,
    }));
    pointerGridPointByAppHost.set(appHost, pathCell);
    await waitForGestureFrame();
  }
}

function resolveGridCellCenterPath(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): readonly { readonly x: number; readonly y: number }[] {
  if (start.x === end.x && start.y === end.y) {
    return [];
  }

  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const stepX = Math.sign(deltaX);
  const stepY = Math.sign(deltaY);
  const timeDeltaX = deltaX === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(deltaX);
  const timeDeltaY = deltaY === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(deltaY);
  let timeToNextX = deltaX === 0 ? Number.POSITIVE_INFINITY : timeDeltaX / 2;
  let timeToNextY = deltaY === 0 ? Number.POSITIVE_INFINITY : timeDeltaY / 2;
  let currentX = start.x;
  let currentY = start.y;
  const path: { x: number; y: number }[] = [];

  while (currentX !== end.x || currentY !== end.y) {
    const reachesGridCorner = Math.abs(timeToNextX - timeToNextY) <= 1e-12;
    if (reachesGridCorner) {
      currentX += stepX;
      currentY += stepY;
      timeToNextX += timeDeltaX;
      timeToNextY += timeDeltaY;
    } else if (timeToNextX < timeToNextY) {
      currentX += stepX;
      timeToNextX += timeDeltaX;
    } else {
      currentY += stepY;
      timeToNextY += timeDeltaY;
    }
    path.push({ x: currentX, y: currentY });
  }

  return path;
}

function expectEntityAt(
  editorHost: EditorHost,
  expected: Pick<WorldEntity, "definitionId" | "position"> & {
    readonly rotation?: WorldEntity["rotation"];
  },
  options: { readonly soft?: boolean } = {},
): void {
  const matchingEntity = Object.values(editorHost.document.getSnapshot().entities).find((entity) =>
    entity.position.x === expected.position.x
    && entity.position.y === expected.position.y
    && entity.definitionId === expected.definitionId
    && (expected.rotation === undefined || entity.rotation === expected.rotation),
  );

  const assertion = options.soft === true ? expect.soft : expect;
  assertion(matchingEntity, [
    `未在 (${expected.position.x}, ${expected.position.y}) 找到`,
    expected.rotation === undefined
      ? expected.definitionId
      : `${expected.definitionId} rotation=${expected.rotation}`,
  ].join(" ")).toBeDefined();
}

function pointerEvent(
  overrides: Partial<GesturePointerEventLike>,
): GesturePointerEventLike {
  return {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function keyEvent(
  overrides: Partial<GestureKeyboardEventLike>,
): GestureKeyboardEventLike {
  return {
    code: "",
    key: "",
    keyCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

// AI-REMOVED 2026-09-14:
// Reason: 内联历史蓝图已迁移为独立 JSON 文件，保留原文用于审计。
// Trigger: 用户要求全部测试蓝图升级并改用带版本号的蓝图文件。
// Evidence: schema 3 场景绕过正式 5→6 迁移，遗漏准入口 270°补偿。
// Replacement: src/tests/fixtures/blueprints/logistics-placement-complete/suppression-overlap.schema6.json
// Risk: Low；原始场景和断言保留，版本迁移使用生产入口。
// Human Review: Required
// Original code:
// const USER_PROVIDED_BLUEPRINT_SUPPRESSION_OVERLAP: BlueprintDocument = {
//   schemaVersion: 4,
//   blueprintId: "dea0569d-2e5d-44d3-913a-ab30dd84fca4",
//   version: "v1.3.0",
//   name: "未命名蓝图-20260801141942",
//   description: "",
//   baseId: "stm_hongs_3",
//   initialGridPoint: { x: 4, y: 4 },
//   entities: {
//     "belt_straight_1x1:13": {
//       id: "belt_straight_1x1:13",
//       definitionId: "belt_straight_1x1",
//       position: { x: 1, y: 3 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "belt_straight_1x1:14": {
//       id: "belt_straight_1x1:14",
//       definitionId: "belt_straight_1x1",
//       position: { x: 2, y: 3 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "pipe_straight_1x1:23": {
//       id: "pipe_straight_1x1:23",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 1, y: 3 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "pipe_straight_1x1:24": {
//       id: "pipe_straight_1x1:24",
//       definitionId: "pipe_straight_1x1",
//       position: { x: 2, y: 3 },
//       rotation: 0,
//       config: {},
//       tags: [],
//     },
//     "storager_1:2": {
//       id: "storager_1:2",
//       definitionId: "storager_1",
//       position: { x: 4, y: 2 },
//       rotation: 90,
//       config: {
//         channelRecipes: {
//           warehouse_submit: "r_warehouse_submit",
//         },
//       },
//       tags: [],
//     },
//   },
//   entityOrder: [
//     "belt_straight_1x1:13",
//     "belt_straight_1x1:14",
//     "pipe_straight_1x1:23",
//     "pipe_straight_1x1:24",
//     "storager_1:2",
//   ],
//   slotLinks: [],
//   regions: [],
//   createdAt: "2026-08-01T06:19:44.518Z",
//   updatedAt: "2026-08-01T06:19:44.518Z",
// };
const USER_PROVIDED_BLUEPRINT_SUPPRESSION_OVERLAP: BlueprintDocument = loadBlueprintFromFile(
  "src/tests/fixtures/blueprints/logistics-placement-complete/suppression-overlap.schema6.json",
);

function resolveClientPixelPointForGridCell(
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const gridCellSize = editorHost.state.viewport.gridCellPixelSize;

  return {
    x:
      editorHost.state.viewport.clientRect.left
      + editorHost.state.viewport.clientRect.width / 2
      + (cell.x + 0.5 - editorHost.state.viewport.center.x) * gridCellSize,
    y:
      editorHost.state.viewport.clientRect.top
      + editorHost.state.viewport.clientRect.height / 2
      + (cell.y + 0.5 - editorHost.state.viewport.center.y) * gridCellSize,
  };
}
