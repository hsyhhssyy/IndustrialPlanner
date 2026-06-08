/**
 * 临时测试：验证蓝图放置多实体旋转是否保持相对位置
 * 用 editor-host 直接测试 createBlueprintPlacementDraft + rotateCollection(preview)
 */
import { describe, expect, it } from "vitest";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null,
  };
}

function logDraft(editorHost: ReturnType<typeof createEditorHost>, label: string) {
  const previewIds = [...editorHost.state.collections.preview];
  const entries = previewIds.map((id) => {
    const e = editorHost.queries.getEntityById(id);
    return e ? `${e.definitionId}@(${e.position.x},${e.position.y}) r${e.rotation}` : null;
  });
  console.log(`  [${label}]`, entries);
}

describe("蓝图多实体旋转 - 相对位置保持", () => {
  it("两个 3x3 设备横向相邻，旋转90度后应纵向相邻", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // 构造蓝图：两个 3x3 storager 相邻
    const blueprint = createBlueprintDocument({
      name: "test-rotation",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 11, y: 10 },
      entities: {
        source: {
          id: "source",
          definitionId: "item_port_storager_1",
          position: { x: 9, y: 9 },
          rotation: 0,
          config: {},
          tags: [],
        },
        target: {
          id: "target",
          definitionId: "item_port_storager_1",
          position: { x: 12, y: 9 },
          rotation: 90,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["source", "target"],
      slotLinks: [],
    });

    // Place at center
    const center = { x: 30, y: 20 };
    editorHost.actions.createBlueprintPlacementDraft!(blueprint, center);

    const previewIds = [...editorHost.state.collections.preview];
    expect(previewIds).toHaveLength(2);
    
    // Get initial positions
    const getPositions = () => {
      return previewIds.map((id) => {
        const e = editorHost.queries.getEntityById(id);
        return e ? { x: e.position.x, y: e.position.y, r: e.rotation, defId: e.definitionId } : null;
      });
    };

    const initial = getPositions();
    logDraft(editorHost, "初始");

    // Rotate once (clockwise 90°)
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const _after1 = getPositions();
    logDraft(editorHost, "旋转1次");

    // Rotate twice (180°)
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const _after2 = getPositions();
    logDraft(editorHost, "旋转2次");

    // Rotate three times (270°)
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const _after3 = getPositions();
    logDraft(editorHost, "旋转3次");

    // Rotate four times (360° - should be back to original relative positions)
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after4 = getPositions();
    logDraft(editorHost, "旋转4次");

    // 四次旋转后相对位置应和初始相同（可能有整体偏移）
    // 验证两个设备之间的相对距离
    if (initial[0] && initial[1] && after4[0] && after4[1]) {
      const initDx = initial[1].x - initial[0].x;
      const initDy = initial[1].y - initial[0].y;
      const finalDx = after4[1].x - after4[0].x;
      const finalDy = after4[1].y - after4[0].y;
      
      console.log(`  初始相对: (${initDx}, ${initDy})`);
      console.log(`  最终相对: (${finalDx}, ${finalDy})`);
      
      // 四次旋转后相对位置应一致
      expect({ dx: finalDx, dy: finalDy }).toEqual({ dx: initDx, dy: initDy });
    }
  });

  it("构建测试蓝图中的两个设备旋转后应保持相邻", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // 模拟 REQ-058 中的测试蓝图
    const blueprint = createBlueprintDocument({
      name: "test",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 10, y: 10 },
      entities: {
        source: {
          id: "source",
          definitionId: "item_port_storager_1",
          position: { x: 9, y: 9 },
          rotation: 0,
          config: {},
          tags: [],
        },
        target: {
          id: "target",
          definitionId: "item_port_storager_1",
          position: { x: 12, y: 9 },
          rotation: 90,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["source", "target"],
      slotLinks: [],
    });

    const center = { x: 30, y: 20 };
    editorHost.actions.createBlueprintPlacementDraft!(blueprint, center);

    const previewIds = [...editorHost.state.collections.preview];
    const getPositions = () => previewIds.map((id) => {
      const e = editorHost.queries.getEntityById(id);
      return e ? { x: e.position.x, y: e.position.y, r: e.rotation, defId: e.definitionId } : null;
    });

    const initial = getPositions();
    console.log("初始:", initial);

    // 旋转 90°
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const rotated = getPositions();
    console.log("旋转90°:", rotated);

    if (initial[0] && initial[1] && rotated[0] && rotated[1]) {
      // 初始时 target 在 source 右边 3 格（因为都是3x3）
      const initDx = initial[1].x - initial[0].x;
      const initDy = initial[1].y - initial[0].y;
      
      // 旋转后 target 应在 source 下方 3 格
      const rotDx = rotated[1].x - rotated[0].x;
      const rotDy = rotated[1].y - rotated[0].y;
      
      console.log(`初始相对: dx=${initDx}, dy=${initDy}`);
      console.log(`旋转相对: dx=${rotDx}, dy=${rotDy}`);
      
      // 期望：旋转90度后相对关系从 (dx, dy) 变成 (-dy, dx) 在 grid 坐标中
      // 即从 (3, 0) 变成 (0, 3)
      expect(rotDx).toBe(0);
      expect(rotDy).toBe(3);
    }
  });
});
