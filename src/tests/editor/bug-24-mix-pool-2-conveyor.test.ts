import { describe, expect, it } from "vitest";

import { createEditorHost } from "@/editor/editor-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorldDocument } from "@/domain/document/world-document";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createRegistryContract } from "@/registry";

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

function createTestEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270 = 0,
): WorldDocument["entities"][string] {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}

describe("Bug #24 - mix_pool_2 传送带预览", () => {
  /**
   * 模拟场景: mix_pool_2 旁边有一个掉头传送带。
   * mix_pool_2 在 (10,10)，6x5 占地。
   * 掉头传送带从 mix_pool_2 南侧输入口旁经过。
   *
   * 布局:
   *   mix_pool_2 占地 x=10..15, y=10..14
   *   输入端口在 SOUTH (y=14), x=11,12,13,14
   *   在 mix_pool_2 下方有一组传送带形成 U 型路径
   */
  it("从 mix_pool_2 下方 U-turn 传送带起笔能正确创建预览", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 放置 mix_pool_2 在 (10,10)
    editorHost.internalDocument.setSnapshot({
      ...createDummyWorldDocument(),
      entities: {
        "mix-pool": createTestEntity("mix-pool", "mix_pool_2", 10, 10, 0),
      },
      entityOrder: ["mix-pool"],
    });

    // mix_pool_2 输入端口在 SOUTH 侧 (y=14), x=11,12,13,14
    // 下方 outsideGridPoint 在 y=15
    // 模拟从输入端口下方 (11,16) 起笔
    const startResult = editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "device",
        entityId: "mix-pool",
        pointerGridPoint: { x: 11, y: 16 },
      },
    });

    console.log("startResult:", JSON.stringify(startResult, null, 2));
    const draft = editorHost.queries.resolveLogisticsDraftState();
    console.log("draft source:", JSON.stringify(draft?.source, null, 2));

    expect(startResult.status).toBe("created");
    expect(startResult.sourceEntityId).toBe("mix-pool");

    // 从输入端口起笔不应有预览 cell（这是设备端口，等待 move）
    expect(draft?.cells.length).toBe(0);
  });

  it("在 mix_pool_2 附近空地起笔，向输入端口绘制单弯路径", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 放置 mix_pool_2 在 (10,10)
    editorHost.internalDocument.setSnapshot({
      ...createDummyWorldDocument(),
      entities: {
        "mix-pool": createTestEntity("mix-pool", "mix_pool_2", 10, 10, 0),
      },
      entityOrder: ["mix-pool"],
    });

    // 输出端口在 NORTH 侧 (y=10), 外部格 y=9
    // 从输出口外侧 (11,9) 起笔
    const startResult = editorHost.actions.createLogisticsDraftStart({
      kind: "belt",
      source: {
        type: "fixed-device-port",
        entityId: "mix-pool",
        portGroupId: "item_output",
        portId: "out_n_1",
        outsideGridPoint: { x: 11, y: 9 },
      },
    });

    console.log("startResult:", JSON.stringify(startResult, null, 2));

    // 向下画到 y=16（到 mix_pool_2 南侧输入口下方）
    const moveResult = editorHost.actions.moveLogisticEnd({
      pointerGridPoint: { x: 11, y: 16 },
      routeMode: {
        type: "single-bend",
        routeOrder: "vertical-first",
        allowTemporaryOrderFlip: true,
      },
    });

    console.log("moveResult:", JSON.stringify(moveResult, null, 2));
    const draft = editorHost.queries.resolveLogisticsDraftState();
    console.log("draft target:", JSON.stringify(draft?.target, null, 2));
    console.log("draft canApply:", draft?.canApply, "invalidReason:", draft?.invalidReason);
    console.log("cells:", draft?.cells.map(c => `(${c.gridPoint.x},${c.gridPoint.y}) ${c.shape}`));
  });
});
