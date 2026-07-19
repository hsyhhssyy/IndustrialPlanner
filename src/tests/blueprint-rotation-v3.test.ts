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

describe("蓝图旋转 — 非正方形(5x5规划器+3x3洪炉)", () => {
  it("5x5 planter(0,0) + 5x5 seedcol(5,0) 相邻，旋转后不应产生重叠", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // planter 5x5 occupies (0,0)-(4,4), seedcol 5x5 occupies (5,0)-(9,4). 相邻无重叠
    // bounds: left=0, top=0, width=10, height=5
    // getGridBoundsCenterCells: (5, 2.5) → round → (5, 3)
    const blueprint = createBlueprintDocument({
      name: "planter-seedcol-v2",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 5, y: 3 },
      entities: {
        p: { id: "p", definitionId: "planter_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        s: { id: "s", definitionId: "seedcol_1", position: { x: 5, y: 0 }, rotation: 0, config: {}, tags: [] },
      },
      entityOrder: ["p", "s"],
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

  it("3x3 furnace(0,0) + 5x5 planter(3,0) 相邻，旋转后不应产生重叠", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // furnace 3x3 occupies (0,0)-(2,2), planter 5x5 occupies (3,0)-(7,4). 相邻
    // bounds: left=0, top=0, width=8, height=5
    // getGridBoundsCenterCells: (4, 2.5) → round → (4, 3)
    const blueprint = createBlueprintDocument({
      name: "furnace-planter",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 4, y: 3 },
      entities: {
        f: { id: "f", definitionId: "furnance_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        p: { id: "p", definitionId: "planter_1", position: { x: 3, y: 0 }, rotation: 0, config: {}, tags: [] },
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

  it("5x3 pool(0,0) + 4x3 hydro_planter(5,0) 相邻，旋转后不应产生重叠", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    // pool 5x3@(0,0)-(4,2), hydro 4x3@(5,0)-(8,2). 相邻
    // bounds: width=9, height=3, center ~ (4.5, 1.5) → round (5, 2)
    const blueprint = createBlueprintDocument({
      name: "pool-hydro",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 5, y: 2 },
      entities: {
        pool: { id: "p1", definitionId: "mix_pool_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        hydro: { id: "h1", definitionId: "hydro_planter_1", position: { x: 5, y: 0 }, rotation: 0, config: {}, tags: [] },
      },
      entityOrder: ["p1", "h1"],
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
