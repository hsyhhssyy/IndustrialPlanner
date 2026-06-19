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
      appHost.internalState.settings.hypergryphOperationMode = true;
      appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = true;
      appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = false;
    });

    enterBeltLogisticsPlacement(appHost);
    pressRouteOrderShortcut(appHost);
    clickCell(appHost, editorHost, { x: 10, y: 2 }, nextPointerId++);
    moveToCell(appHost, editorHost, { x: 7, y: 6 }, nextPointerId++);
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

  it("从 6,3 布设到 2,5 后生成两个顺时针弯道", () => {
    clickCell(appHost, editorHost, { x: 6, y: 3 }, nextPointerId++);
    moveToCell(appHost, editorHost, { x: 2, y: 5 }, nextPointerId++);
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

  it("从 6,3 布设到 1,5 后在 2,5 生成桥接器", () => {
    clickCell(appHost, editorHost, { x: 6, y: 3 }, nextPointerId++);
    moveToCell(appHost, editorHost, { x: 1, y: 5 }, nextPointerId++);
    clickCell(appHost, editorHost, { x: 1, y: 5 }, nextPointerId++);

    expectEntityAt(editorHost, {
      definitionId: "belt_turn_cw_1x1",
      position: { x: 6, y: 5 },
      rotation: 270,
    }, { soft: true });
    expectEntityAt(editorHost, {
      definitionId: "item_log_connector",
      position: { x: 2, y: 5 },
    }, { soft: true });
  });
});

const USER_PROVIDED_BLUEPRINT: BlueprintDocument = {
  schemaVersion: 1,
  blueprintId: "7d8dd13e-274d-47c3-9000-799df527c807",
  version: "v1.3.0",
  name: "1111",
  description: "",
  baseId: "wuling_protocol_core",
  initialGridPoint: { x: 6, y: 5 },
  entities: {
    "item_port_liquid_furnance_1:2": {
      id: "item_port_liquid_furnance_1:2",
      definitionId: "item_port_liquid_furnance_1",
      position: { x: 4, y: 0 },
      rotation: 180,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:84:0": {
      id: "logistics-draft:belt:84:0",
      definitionId: "belt_straight_1x1",
      position: { x: 6, y: 3 },
      rotation: 90,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:87:1": {
      id: "logistics-draft:belt:87:1",
      definitionId: "belt_turn_ccw_1x1",
      position: { x: 6, y: 4 },
      rotation: 0,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:86:2": {
      id: "logistics-draft:belt:86:2",
      definitionId: "belt_straight_1x1",
      position: { x: 7, y: 4 },
      rotation: 0,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:88:3": {
      id: "logistics-draft:belt:88:3",
      definitionId: "belt_straight_1x1",
      position: { x: 8, y: 4 },
      rotation: 0,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:143:1": {
      id: "logistics-draft:belt:143:1",
      definitionId: "belt_straight_1x1",
      position: { x: 2, y: 6 },
      rotation: 270,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:144:2": {
      id: "logistics-draft:belt:144:2",
      definitionId: "belt_straight_1x1",
      position: { x: 2, y: 5 },
      rotation: 270,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:145:3": {
      id: "logistics-draft:belt:145:3",
      definitionId: "belt_straight_1x1",
      position: { x: 2, y: 4 },
      rotation: 270,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:157:2": {
      id: "logistics-draft:belt:157:2",
      definitionId: "belt_straight_1x1",
      position: { x: 3, y: 8 },
      rotation: 0,
      config: {},
      tags: [],
    },
    "logistics-draft:belt:158:3": {
      id: "logistics-draft:belt:158:3",
      definitionId: "belt_straight_1x1",
      position: { x: 4, y: 8 },
      rotation: 0,
      config: {},
      tags: [],
    },
  },
  entityOrder: [
    "item_port_liquid_furnance_1:2",
    "logistics-draft:belt:84:0",
    "logistics-draft:belt:87:1",
    "logistics-draft:belt:86:2",
    "logistics-draft:belt:88:3",
    "logistics-draft:belt:143:1",
    "logistics-draft:belt:144:2",
    "logistics-draft:belt:145:3",
    "logistics-draft:belt:157:2",
    "logistics-draft:belt:158:3",
  ],
  slotLinks: [],
  createdAt: "2026-06-19T08:48:20.300Z",
  updatedAt: "2026-06-19T08:48:20.300Z",
};

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
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

function resetCanvasFromUserBlueprint(editorHost: EditorHost): void {
  const emptyDocument = createWorldDocument({
    baseId: USER_PROVIDED_BLUEPRINT.baseId,
  });
  editorHost.internalDocument.setSnapshot(emptyDocument);

  const blueprintDocument: WorldDocument = {
    ...emptyDocument,
    entities: structuredClone(USER_PROVIDED_BLUEPRINT.entities),
    entityOrder: [...USER_PROVIDED_BLUEPRINT.entityOrder],
    slotLinks: structuredClone(USER_PROVIDED_BLUEPRINT.slotLinks),
    documentSettings: {
      ...emptyDocument.documentSettings,
      viewport: {
        center: { ...USER_PROVIDED_BLUEPRINT.initialGridPoint },
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
    runtime.routeOrder = "horizontal-first";
    appHost.internalState.runtime.selectingPlacementGroup = "beltLogistics";
  });
  appHost.internalActions.setActiveTool("logistics-placement");
}

function pressRouteOrderShortcut(appHost: AppHost): void {
  appHost.gestureAdapter.handleKeyDown(keyEvent({
    code: "KeyR",
    key: "r",
    keyCode: 82,
  }));
}

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
}

function moveToCell(
  appHost: AppHost,
  editorHost: EditorHost,
  cell: { readonly x: number; readonly y: number },
  pointerId: number,
): void {
  const point = resolveClientPixelPointForGridCell(editorHost, cell);
  appHost.gestureAdapter.handlePointerMove(pointerEvent({
    pointerId,
    clientX: point.x,
    clientY: point.y,
    button: -1,
    buttons: 0,
  }));
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
