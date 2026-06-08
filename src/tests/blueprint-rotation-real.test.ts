/**
 * 使用注册表中真实footprint测试蓝图旋转
 * 模拟真实蓝图中混合尺寸设备的旋转行为
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
    app: null,
  };
}

/** 从entity注册表获取footprint */
function getFootprint(editorHost: ReturnType<typeof createEditorHost>, defId: string): { w: number; h: number } {
  const def = editorHost.workspace.registry.entityDefinitions.find(d => d.id === defId);
  if (def) return { w: def.footprint.width, h: def.footprint.height };
  return { w: 1, h: 1 };
}

function entityBounds(e: { position: { x: number; y: number }; rotation: number }, w: number, h: number) {
  const rw = (e.rotation === 90 || e.rotation === 270) ? h : w;
  const rh = (e.rotation === 90 || e.rotation === 270) ? w : h;
  return { left: e.position.x, top: e.position.y, right: e.position.x + rw, bottom: e.position.y + rh };
}

function areAdjacent(a: ReturnType<typeof entityBounds>, b: ReturnType<typeof entityBounds>): boolean {
  if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) {
    const hTouch = (a.right === b.left || b.right === a.left) && a.bottom > b.top && b.bottom > a.top;
    const vTouch = (a.bottom === b.top || b.bottom === a.top) && a.right > b.left && b.right > a.left;
    return hTouch || vTouch;
  }
  return false; // 重叠
}

function overlaps(a: ReturnType<typeof entityBounds>, b: ReturnType<typeof entityBounds>): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe("蓝图旋转 — 真实尺寸设备旋转验证", () => {
  it("3x3 furnace(0,0) + 3x3 grinder(3,0) + 1x1 belt(0,3)：旋转后设备间不应重叠且保持相邻", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // furnace 3x3 @(0,0), grinder 3x3 @(3,0) 相邻, belt 1x1 @(0,3) 在furnace下方相邻
    const blueprint = createBlueprintDocument({
      name: "real-test-1",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 2, y: 2 },
      entities: {
        furnace: { id: "f", definitionId: "item_port_furnance_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        grinder: { id: "g", definitionId: "item_port_grinder_1", position: { x: 3, y: 0 }, rotation: 0, config: {}, tags: [] },
        belt: { id: "b", definitionId: "belt_straight_1x1", position: { x: 0, y: 3 }, rotation: 0, config: {}, tags: [] },
      },
      entityOrder: ["f", "g", "b"],
      slotLinks: [],
    });

    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    const getData = () => {
      const ids = [...editorHost.state.collections.preview];
      const entities = ids.map((id) => {
        const e = editorHost.queries.getEntityById(id);
        return e ? { ...e, fp: getFootprint(editorHost, e.definitionId) } : null;
      }).filter(Boolean) as Array<{
        position: { x: number; y: number }; rotation: number; definitionId: string; fp: { w: number; h: number }
      }>;
      let overlapCount = 0, adj = 0;
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const a = entityBounds(entities[i], entities[i].fp.w, entities[i].fp.h);
          const b = entityBounds(entities[j], entities[j].fp.w, entities[j].fp.h);
          if (overlaps(a, b)) overlapCount++;
          else if (areAdjacent(a, b)) adj++;
        }
      }
      const positions = entities.map(e => `${e.definitionId.split('_').pop()}@(${e.position.x},${e.position.y}) r${e.rotation}`);
      return { overlapCount, adj, positions };
    };

    const init = getData();
    console.log("初始:", init);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after90 = getData();
    console.log("90°:", after90);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after180 = getData();
    console.log("180°:", after180);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after270 = getData();
    console.log("270°:", after270);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after360 = getData();
    console.log("360°:", after360);

    expect(after90.overlapCount).toBe(0);
    expect(after180.overlapCount).toBe(0);
    expect(after270.overlapCount).toBe(0);
    expect(after360.overlapCount).toBe(0);
    expect(after360.adj).toBe(init.adj);
  });

  it("4x3 planter + 2x2 seedcol：非正方形设备旋转后不应重叠", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // planter 4x3 @(0,0), seedcol 2x2 @(4,0)
    const blueprint = createBlueprintDocument({
      name: "real-test-2",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 3, y: 2 },
      entities: {
        planter: { id: "p", definitionId: "item_port_planter_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        seedcol: { id: "s", definitionId: "item_port_seedcol_1", position: { x: 4, y: 0 }, rotation: 0, config: {}, tags: [] },
      },
      entityOrder: ["p", "s"],
      slotLinks: [],
    });

    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    const getData = () => {
      const ids = [...editorHost.state.collections.preview];
      const entities = ids.map((id) => {
        const e = editorHost.queries.getEntityById(id);
        return e ? { ...e, fp: getFootprint(editorHost, e.definitionId) } : null;
      }).filter(Boolean) as Array<{
        position: { x: number; y: number }; rotation: number; definitionId: string; fp: { w: number; h: number }
      }>;
      let overlapCount = 0, adj = 0;
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const a = entityBounds(entities[i], entities[i].fp.w, entities[i].fp.h);
          const b = entityBounds(entities[j], entities[j].fp.w, entities[j].fp.h);
          if (overlaps(a, b)) overlapCount++;
          else if (areAdjacent(a, b)) adj++;
        }
      }
      const positions = entities.map(e => `${e.definitionId.split('_').pop()}@(${e.position.x},${e.position.y}) r${e.rotation}`);
      return { overlapCount, adj, positions };
    };

    const init = getData();
    console.log("初始:", init);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after90 = getData();
    console.log("90°:", after90);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after180 = getData();
    console.log("180°:", after180);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after270 = getData();
    console.log("270°:", after270);

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const after360 = getData();
    console.log("360°:", after360);

    expect(after90.overlapCount).toBe(0);
    expect(after180.overlapCount).toBe(0);
    expect(after270.overlapCount).toBe(0);
    expect(after360.overlapCount).toBe(0);
    expect(after360.adj).toBe(init.adj);
  });
});
