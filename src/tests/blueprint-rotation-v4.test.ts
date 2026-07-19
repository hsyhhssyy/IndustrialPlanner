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

interface EBox {
  position: { x: number; y: number }; rotation: number; defId: string; fw: number; fh: number;
}
function bbox(e: EBox) {
  const rw = (e.rotation === 90 || e.rotation === 270) ? e.fh : e.fw;
  const rh = (e.rotation === 90 || e.rotation === 270) ? e.fw : e.fh;
  return { left: e.position.x, top: e.position.y, right: e.position.x + rw, bottom: e.position.y + rh };
}
function adj(a: ReturnType<typeof bbox>, b: ReturnType<typeof bbox>) {
  if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) {
    return (a.right === b.left || b.right === a.left) && a.bottom > b.top && b.bottom > a.top
        || (a.bottom === b.top || b.bottom === a.top) && a.right > b.left && b.right > a.left;
  }
  return false;
}
function ov(a: ReturnType<typeof bbox>, b: ReturnType<typeof bbox>) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

type Host = ReturnType<typeof createEditorHost>;

function analyze(editorHost: Host): { ov: number; adj: number; es: EBox[] } {
  const ids = [...editorHost.state.collections.preview];
  const es: EBox[] = ids.map((id) => {
    const e = editorHost.queries.getEntityById(id);
    if (!e) throw new Error(`Entity not found: ${id}`);
    const f = fp(editorHost, e.definitionId);
    return { position: e.position, rotation: e.rotation, defId: e.definitionId, fw: f.w, fh: f.h };
  });
  if (es.length === 0) return { ov: 0, adj: 0, es: [] };
  let ovc = 0, adjc = 0;
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      if (ov(bbox(es[i]!), bbox(es[j]!))) ovc++;
      else if (adj(bbox(es[i]!), bbox(es[j]!))) adjc++;
    }
  }
  return { ov: ovc, adj: adjc, es };
}

function fmt(e: EBox) {
  const short = e.defId.replace('item_port_', '').replace('belt_', '');
  return `${short}@(${e.position.x},${e.position.y})r${e.rotation}[${e.fw}x${e.fh}]`;
}

describe("蓝图旋转 — 包含非零旋转的设备", () => {
  it("furnace(0,0)r0 + planter(3,0)r180 非零初始旋转，旋转后不应重叠", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // furnace 3x3@(0,0)r0 占据 (0,0)-(2,2)
    // planter 5x5@(3,0)r180 占据 (3,0)-(7,4) (5x5 is symmetric, same space)
    // 相邻
    const blueprint = createBlueprintDocument({
      name: "furnace-planter-r180",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 4, y: 3 },
      entities: {
        f: { id: "f", definitionId: "furnance_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        p: { id: "p", definitionId: "planter_1", position: { x: 3, y: 0 }, rotation: 180, config: {}, tags: [] },
      },
      entityOrder: ["f", "p"],
      slotLinks: [],
    });

    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    let r = analyze(editorHost);
    console.log(`初始 [ov=${r.ov} adj=${r.adj}]:`, r.es.map(fmt));
    expect(r.ov).toBe(0);
    const initAdj = r.adj;

    for (let step = 1; step <= 4; step++) {
      editorHost.actions.rotateCollection(EntityCollectionType.preview);
      r = analyze(editorHost);
      console.log(`${step*90}° [ov=${r.ov} adj=${r.adj}]:`, r.es.map(fmt));
      expect(r.ov).toBe(0);
    }
    expect(r.adj).toBe(initAdj);
  });

  it("bent belt 转角: 两个 1x1 belt 形成L形，加入非零旋转设备", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // belt1(0,0)r0, belt2(1,0)r0, belt3(1,1)r90 (L形)
    // belt1-belt2 相邻横，belt2-belt3 相邻竖（belt2右=2, belt3左=1... 不，belt3@(1,1) footprint 1x1@90 仍1x1）
    // belt2 right=2, belt3 left=1, belt3 bottom=2, belt2 top=0. 不走水平和竖直任一接触.
    // belt2@(1,0) occupies (1,0); belt3@(1,1) occupies (1,1). 竖直相邻.
    const blueprint = createBlueprintDocument({
      name: "L-belt",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 1, y: 1 },
      entities: {
        b1: { id: "b1", definitionId: "belt_straight_1x1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        b2: { id: "b2", definitionId: "belt_straight_1x1", position: { x: 1, y: 0 }, rotation: 0, config: {}, tags: [] },
        b3: { id: "b3", definitionId: "belt_straight_1x1", position: { x: 1, y: 1 }, rotation: 90, config: {}, tags: [] },
      },
      entityOrder: ["b1", "b2", "b3"],
      slotLinks: [],
    });

    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    let r = analyze(editorHost);
    console.log(`初始 [ov=${r.ov} adj=${r.adj}]:`, r.es.map(fmt));
    expect(r.ov).toBe(0);
    const initAdj = r.adj;

    for (let step = 1; step <= 4; step++) {
      editorHost.actions.rotateCollection(EntityCollectionType.preview);
      r = analyze(editorHost);
      console.log(`${step*90}° [ov=${r.ov} adj=${r.adj}]:`, r.es.map(fmt));
      expect(r.ov).toBe(0);
    }
    expect(r.adj).toBe(initAdj);
  });
});
