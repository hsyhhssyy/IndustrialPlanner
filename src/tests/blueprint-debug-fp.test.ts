import { describe, expect, it } from "vitest";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

function createWorkspace(): WorkspaceContract {
  return { state: createWorkspaceState(), registry: createRegistryContract(), app: null };
}

describe("调试", () => {
  it("debug registry footprint lookup", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    const defs = workspace.registry.entityDefinitions;
    console.log("entityDefinitions type:", typeof defs, Array.isArray(defs) ? `array(${defs.length})` : 'other');
    
    const planter = defs.find(d => d.id === "item_port_planter_1");
    console.log("planter:", planter ? `fp=${planter.footprint.width}x${planter.footprint.height}` : "NOT FOUND");
    
    const seedcol = defs.find(d => d.id === "item_port_seedcol_1");
    console.log("seedcol:", seedcol ? `fp=${seedcol.footprint.width}x${seedcol.footprint.height}` : "NOT FOUND");
    
    const furnance = defs.find(d => d.id === "item_port_furnance_1");
    console.log("furnance:", furnance ? `fp=${furnance.footprint.width}x${furnance.footprint.height}` : "NOT FOUND");

    const blueprint = createBlueprintDocument({
      name: "test",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 2, y: 2 },
      entities: {
        p: { id: "p", definitionId: "item_port_planter_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        s: { id: "s", definitionId: "item_port_seedcol_1", position: { x: 6, y: 0 }, rotation: 0, config: {}, tags: [] },
      },
      entityOrder: ["p", "s"],
      slotLinks: [],
    });

    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    const ids = [...editorHost.state.collections.preview];
    console.log("preview IDs:", ids);

    for (const id of ids) {
      const e = editorHost.queries.getEntityById(id);
      if (e) {
        const defFromEditor = editorHost.workspace.registry.entityDefinitions.find(d => d.id === e.definitionId);
        console.log(`  ${id}: defId=${e.definitionId}, pos=(${e.position.x},${e.position.y}), rot=${e.rotation}`);
        console.log(`    registry footprint: ${defFromEditor ? `${defFromEditor.footprint.width}x${defFromEditor.footprint.height}` : "NOT FOUND"}`);
      }
    }
  });
});
