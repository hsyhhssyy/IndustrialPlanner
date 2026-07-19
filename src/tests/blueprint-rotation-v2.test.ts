import { describe, expect, it } from "vitest";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

function createWorkspace(): WorkspaceContract {
  return { state: createWorkspaceState(), registry: createRegistryContract(), app: null, editor: null, render: null, simulation: null };
}

function fp(editorHost: ReturnType<typeof createEditorHost>, defId: string): { w: number; h: number } {
  const d = editorHost.workspace.registry.entityDefinitions.find(x => x.id === defId);
  return d ? { w: d.footprint.width, h: d.footprint.height } : { w: 1, h: 1 };
}

interface EntityBox {
  position: { x: number; y: number }; rotation: number; defId: string; fw: number; fh: number;
}
function bbox(e: EntityBox) {
  const rw = (e.rotation === 90 || e.rotation === 270) ? e.fh : e.fw;
  const rh = (e.rotation === 90 || e.rotation === 270) ? e.fw : e.fh;
  return { left: e.position.x, top: e.position.y, right: e.position.x + rw, bottom: e.position.y + rh };
}
function areAdj(a: ReturnType<typeof bbox>, b: ReturnType<typeof bbox>) {
  if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) {
    return (a.right === b.left || b.right === a.left) && a.bottom > b.top && b.bottom > a.top
        || (a.bottom === b.top || b.bottom === a.top) && a.right > b.left && b.right > a.left;
  }
  return false;
}
function areOv(a: ReturnType<typeof bbox>, b: ReturnType<typeof bbox>) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

type Host = ReturnType<typeof createEditorHost>;

function analyze(editorHost: Host): { overlapCount: number; adjCount: number; entities: EntityBox[] } {
  const ids = [...editorHost.state.collections.preview];
  const entities: EntityBox[] = ids.map((id) => {
    const e = editorHost.queries.getEntityById(id);
    if (!e) throw new Error(`Entity not found: ${id}`);
    const f = fp(editorHost, e.definitionId);
    return { position: e.position, rotation: e.rotation, defId: e.definitionId, fw: f.w, fh: f.h };
  });
  let overlapCount = 0, adjCount = 0;
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (areOv(bbox(entities[i]!), bbox(entities[j]!))) overlapCount++;
      else if (areAdj(bbox(entities[i]!), bbox(entities[j]!))) adjCount++;
    }
  }
  return { overlapCount, adjCount, entities };
}

function fmt(e: EntityBox) {
  const short = e.defId.replace('item_port_', '').replace('belt_', '');
  return `${short}@(${e.position.x},${e.position.y})r${e.rotation}`;
}

describe("蓝图旋转 — 非正方形设备", () => {
  it("planter + seedcol 相邻放置，旋转后不应重叠且相邻关系恢复", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // 2026-06-09 订正：设备 footprint 以当前 registry 为准，本用例不再依赖下方旧手算尺寸备注。
    // planter 4x3 left=(0,0)-(3,2), seedcol 2x2 right=(4,0)-(5,1)
    // 手动计算 initialGridPoint:
    // bounds: left=0, top=0, width=6, height=3
    // getGridBoundsCenterCells: (0+6/2, 0+3/2) = (3, 1.5) → round → (3, 2)
    const blueprint = createBlueprintDocument({
      name: "planter-seedcol",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 3, y: 2 },
      entities: {
        p: { id: "p", definitionId: "planter_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        s: { id: "s", definitionId: "seedcol_1", position: { x: 5, y: 0 }, rotation: 0, config: {}, tags: [] },
      },
      entityOrder: ["p", "s"],
      slotLinks: [],
    });

    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    const init = analyze(editorHost);
    console.log(`初始 [overlap=${init.overlapCount} adj=${init.adjCount}]:`, init.entities.map(fmt));

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const r90 = analyze(editorHost);
    console.log(`90°  [overlap=${r90.overlapCount} adj=${r90.adjCount}]:`, r90.entities.map(fmt));

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const r180 = analyze(editorHost);
    console.log(`180° [overlap=${r180.overlapCount} adj=${r180.adjCount}]:`, r180.entities.map(fmt));

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const r270 = analyze(editorHost);
    console.log(`270° [overlap=${r270.overlapCount} adj=${r270.adjCount}]:`, r270.entities.map(fmt));

    editorHost.actions.rotateCollection(EntityCollectionType.preview);
    const r360 = analyze(editorHost);
    console.log(`360° [overlap=${r360.overlapCount} adj=${r360.adjCount}]:`, r360.entities.map(fmt));

    expect(r90.overlapCount).toBe(0);
    expect(r180.overlapCount).toBe(0);
    expect(r270.overlapCount).toBe(0);
    expect(r360.overlapCount).toBe(0);
    expect(r360.adjCount).toBe(init.adjCount);
  });

  it("furnace(3x3) + grinder(3x3) + belt(1x1) 相邻放置，所有旋转不应有重叠", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // furnace 3x3(0,0)-(2,2), grinder 3x3(3,0)-(5,2), belt 1x1(0,3)
    // bounds: left=0, top=0, width=6, height=4
    // getGridBoundsCenterCells: (3, 2) → round → (3, 2)
    const blueprint = createBlueprintDocument({
      name: "furnace-grinder-belt",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 3, y: 2 },
      entities: {
        f: { id: "f", definitionId: "furnance_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        g: { id: "g", definitionId: "grinder_1", position: { x: 3, y: 0 }, rotation: 0, config: {}, tags: [] },
        b: { id: "b", definitionId: "belt_straight_1x1", position: { x: 0, y: 3 }, rotation: 0, config: {}, tags: [] },
      },
      entityOrder: ["f", "g", "b"],
      slotLinks: [],
    });

    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    const init = analyze(editorHost);
    console.log(`初始 [ov=${init.overlapCount} adj=${init.adjCount}]:`, init.entities.map(fmt));

    for (let step = 1; step <= 4; step++) {
      editorHost.actions.rotateCollection(EntityCollectionType.preview);
      const r = analyze(editorHost);
      console.log(`${step*90}° [ov=${r.overlapCount} adj=${r.adjCount}]:`, r.entities.map(fmt));
      expect(r.overlapCount).toBe(0);
    }

    const final = analyze(editorHost);
    expect(final.adjCount).toBe(init.adjCount);
  });
});
