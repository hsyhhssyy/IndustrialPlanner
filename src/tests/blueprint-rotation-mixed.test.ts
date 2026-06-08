/**
 * 测试蓝图多实体旋转 — 混合不同尺寸设备
 * 验证旋转后设备间的相对位置（相邻/重叠关系）是否保持
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

/** 获取实体的包围盒 (minX, minY, maxX, maxY) - max 是 exclusive */
function entityBounds(e: { position: { x: number; y: number }; rotation: number }, footprintW: number, footprintH: number) {
  const w = (e.rotation === 90 || e.rotation === 270) ? footprintH : footprintW;
  const h = (e.rotation === 90 || e.rotation === 270) ? footprintW : footprintH;
  return {
    left: e.position.x,
    top: e.position.y,
    right: e.position.x + w,
    bottom: e.position.y + h,
  };
}

/** 两个实体的包围盒是否相邻（不重叠但有公共边或角接触也算相邻） */
function areAdjacent(a: ReturnType<typeof entityBounds>, b: ReturnType<typeof entityBounds>): boolean {
  // 不重叠
  if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) {
    // 检查是否有一条边刚好接触
    const hTouch = (a.right === b.left || b.right === a.left) && a.bottom > b.top && b.bottom > a.top;
    const vTouch = (a.bottom === b.top || b.bottom === a.top) && a.right > b.left && b.right > a.left;
    return hTouch || vTouch;
  }
  return false; // 重叠
}

/** 两个实体的包围盒是否重叠 */
function overlaps(a: ReturnType<typeof entityBounds>, b: ReturnType<typeof entityBounds>): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && b.top > a.bottom;
}

/** 获取定义ID对应的footprint */
const FOOTPRINT_MAP: Record<string, { w: number; h: number }> = {
  item_port_storager_1: { w: 3, h: 3 },
  belt_straight_1x1: { w: 1, h: 1 },
  belt_turn_cw_1x1: { w: 1, h: 1 },
  belt_turn_ccw_1x1: { w: 1, h: 1 },
  pipe_straight_1x1: { w: 1, h: 1 },
  item_port_grinder_1: { w: 2, h: 2 },
  item_pipe_splitter: { w: 1, h: 1 },
  item_port_thickener_1: { w: 3, h: 2 },
  item_port_furnance_1: { w: 4, h: 3 },
  item_port_power_diffuser_1: { w: 3, h: 3 },
  item_port_hydro_planter_1: { w: 4, h: 3 },
  item_port_seedcol_1: { w: 2, h: 2 },
  item_port_planter_1: { w: 4, h: 3 },
  item_port_xiranite_oven_1: { w: 3, h: 3 },
  item_port_mix_pool_1: { w: 5, h: 3 },
  item_port_mix_pool_large_1: { w: 5, h: 3 },
};

function getFootprint(defId: string): { w: number; h: number } {
  return FOOTPRINT_MAP[defId] ?? { w: 1, h: 1 };
}

function collectAdjacencyData(
  editorHost: ReturnType<typeof createEditorHost>,
): { overlapCount: number; adjacentPairs: number; totalPairs: number } {
  const previewIds = [...editorHost.state.collections.preview];
  const entities = previewIds.map((id) => {
    const e = editorHost.queries.getEntityById(id);
    return e ? { ...e, fp: getFootprint(e.definitionId) } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  let overlapCount = 0;
  let adjacentPairs = 0;
  const totalPairs = entities.length * (entities.length - 1) / 2;

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entityBounds(
        { position: entities[i]!.position, rotation: entities[i]!.rotation },
        entities[i]!.fp.w,
        entities[i]!.fp.h,
      );
      const b = entityBounds(
        { position: entities[j]!.position, rotation: entities[j]!.rotation },
        entities[j]!.fp.w,
        entities[j]!.fp.h,
      );
      if (overlaps(a, b)) overlapCount++;
      // 只统计相邻（非重叠）
      else if (areAdjacent(a, b)) adjacentPairs++;
    }
  }

  return { overlapCount, adjacentPairs, totalPairs };
}

describe("蓝图旋转 — 混合尺寸设备相对位置保持", () => {
  it("混合尺寸：3x3 + 1x1 belt + 2x2 grinder，旋转后不应重叠", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // 构造蓝图：3x3 storager @ (0,0) + 1x1 belt @ (3,0) + 2x2 grinder @ (0,3)
    // storager: (0,0)-(2,2), belt: (3,0), grinder: (0,3)-(1,4)
    // belt与storager相邻（右边界接触）, grinder与storager相邻（下边界接触）
    const blueprint = createBlueprintDocument({
      name: "mixed-test",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 2, y: 2 },
      entities: {
        storager: {
          id: "storager", definitionId: "item_port_storager_1",
          position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [],
        },
        belt: {
          id: "belt", definitionId: "belt_straight_1x1",
          position: { x: 3, y: 0 }, rotation: 0, config: {}, tags: [],
        },
        grinder: {
          id: "grinder", definitionId: "item_port_grinder_1",
          position: { x: 0, y: 3 }, rotation: 0, config: {}, tags: [],
        },
      },
      entityOrder: ["storager", "belt", "grinder"],
      slotLinks: [],
    });

    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    const initialData = collectAdjacencyData(editorHost);
    console.log("初始:", initialData);

    // 旋转90度
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after90 = collectAdjacencyData(editorHost);
    console.log("旋转90:", after90);

    // 旋转180度
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after180 = collectAdjacencyData(editorHost);
    console.log("旋转180:", after180);

    // 旋转270度
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after270 = collectAdjacencyData(editorHost);
    console.log("旋转270:", after270);

    // 旋转360度
    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after360 = collectAdjacencyData(editorHost);
    console.log("旋转360:", after360);

    // 所有旋转后都不应有重叠
    expect(after90.overlapCount).toBe(0);
    expect(after180.overlapCount).toBe(0);
    expect(after270.overlapCount).toBe(0);
    expect(after360.overlapCount).toBe(0);

    // 360度后相邻关系应和初始相同
    expect(after360.adjacentPairs).toBe(initialData.adjacentPairs);
  });

  it("3x3 furnace + 2x2 devices mixed, 90度旋转后检查具体位置", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // furnace(4x3) at (0,0), 1x1 belt at (4,0), 2x2 grinder at (0,3)
    const blueprint = createBlueprintDocument({
      name: "furnace-test",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 3, y: 2 },
      entities: {
        furnace: {
          id: "furnace", definitionId: "item_port_furnance_1",
          position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [],
        },
        belt: {
          id: "belt", definitionId: "belt_straight_1x1",
          position: { x: 4, y: 0 }, rotation: 0, config: {}, tags: [],
        },
        grinder: {
          id: "grinder", definitionId: "item_port_grinder_1",
          position: { x: 0, y: 3 }, rotation: 0, config: {}, tags: [],
        },
      },
      entityOrder: ["furnace", "belt", "grinder"],
      slotLinks: [],
    });

    const center = { x: 20, y: 20 };
    editorHost.actions.createBlueprintPlacementDraft!(blueprint, center);

    const previewIds = [...editorHost.state.collections.preview];
    const getPositions = () => previewIds.map((id) => {
      const e = editorHost.queries.getEntityById(id);
      return e ? { defId: e.definitionId, x: e.position.x, y: e.position.y, r: e.rotation } : null;
    }).filter(Boolean);

    console.log("初始:", getPositions());
    const initialBounds = collectAdjacencyData(editorHost);
    console.log("初始数据:", initialBounds);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    console.log("旋转90:", getPositions());
    const after90 = collectAdjacencyData(editorHost);
    console.log("旋转90数据:", after90);
    expect(after90.overlapCount).toBe(0);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    console.log("旋转180:", getPositions());
    const after180 = collectAdjacencyData(editorHost);
    console.log("旋转180数据:", after180);
    expect(after180.overlapCount).toBe(0);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after270 = collectAdjacencyData(editorHost);
    expect(after270.overlapCount).toBe(0);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after360 = collectAdjacencyData(editorHost);
    expect(after360.adjacentPairs).toBe(initialBounds.adjacentPairs);
  });
});
