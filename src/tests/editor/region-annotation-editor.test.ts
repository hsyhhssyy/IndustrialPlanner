import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRegionBlueprintDocument,
  createSelectionBlueprintDocument,
} from "@/app/blueprint/save-blueprint";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createRegionMoveFeedback } from "@/editor/region-relations";
import { createRegistryContract } from "@/registry";
import { resolveRegionGridArea } from "@/shared/geometry/region-rects";
import { createFakeIndexedDbFactory } from "@/tests/shared/fake-indexed-db";

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

function createDocument(options: {
  readonly entities?: readonly WorldEntity[];
  readonly regions?: WorldDocument["regions"];
} = {}): WorldDocument {
  const entities = options.entities ?? [];
  return {
    ...createWorldDocument(),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
    regions: options.regions ?? [],
  };
}

function createEntity(options: {
  readonly id: string;
  readonly definitionId: string;
  readonly x: number;
  readonly y: number;
}): WorldEntity {
  return {
    id: options.id,
    definitionId: options.definitionId,
    position: { x: options.x, y: options.y },
    rotation: 0,
    config: {},
    tags: [],
  };
}

describe("region annotation editor integration", () => {
  let editor: EditorHost | null = null;

  beforeEach(() => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  });

  afterEach(() => {
    editor?.dispose();
    editor = null;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("commits create, edit and delete as reversible region history", () => {
    editor = createEditorHost(createWorkspace());
    editor.internalDocument.setSnapshot(createDocument());

    editor.actions.beginRegionDraft();
    expect(editor.actions.commitRegionDraft()).toBe(false);
    editor.actions.updateRegionDraft({
      name: " 装配区 ",
      description: " 主装配线 ",
      color: "#10b981",
    });
    editor.actions.setRegionDraftMarquee({ x: 0, y: 0, width: 5, height: 5 });
    editor.actions.applyRegionDraftMarquee();
    editor.actions.setRegionDraftOperation("subtract");
    editor.actions.setRegionDraftMarquee({ x: 1, y: 1, width: 3, height: 3 });
    editor.actions.applyRegionDraftMarquee();

    expect(editor.actions.commitRegionDraft()).toBe(true);
    const created = editor.document.getSnapshot().regions[0];
    expect(created).toMatchObject({
      name: "装配区",
      description: "主装配线",
      color: "#10B981",
    });
    expect(resolveRegionGridArea(created?.rects ?? [])).toBe(16);
    expect(editor.state.history.records.at(-1)?.action.type).toBe("region.create");

    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(editor.document.getSnapshot().regions).toEqual([]);
    expect(editor.actions.redoDocumentHistory()).toBe(true);
    expect(editor.document.getSnapshot().regions[0]?.id).toBe(created?.id);

    editor.actions.beginRegionDraft(created?.id);
    editor.actions.updateRegionDraft({ name: "成品装配区" });
    expect(editor.actions.commitRegionDraft()).toBe(true);
    expect(editor.state.history.records.at(-1)?.action.type).toBe("region.edit");
    expect(editor.document.getSnapshot().regions[0]?.name).toBe("成品装配区");

    editor.actions.deleteRegion(created?.id ?? "");
    expect(editor.state.history.records.at(-1)?.action.type).toBe("region.delete");
    expect(editor.document.getSnapshot().regions).toEqual([]);
    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(editor.document.getSnapshot().regions[0]?.name).toBe("成品装配区");
  });

  it("uses one containment rule for queries, move feedback and region blueprints", () => {
    const workspace = createWorkspace();
    const definition = workspace.registry.entityDefinitions.find((candidate) => (
      candidate.footprint.width > 1 && candidate.footprint.height > 1
    ));
    expect(definition).toBeDefined();

    const contained = createEntity({
      id: "contained",
      definitionId: definition!.id,
      x: 0,
      y: 0,
    });
    const boundary = createEntity({
      id: "boundary",
      definitionId: definition!.id,
      x: 1,
      y: 0,
    });
    const region = {
      id: "region-1",
      name: "生产区",
      description: "只纳入完整设备",
      color: "#3B82F6",
      rects: [{
        x: 0,
        y: 0,
        width: definition!.footprint.width,
        height: definition!.footprint.height,
      }],
    } as const;

    editor = createEditorHost(workspace);
    editor.internalDocument.setSnapshot(createDocument({
      entities: [contained, boundary],
      regions: [region],
    }));

    expect(editor.queries.findRegionEntityIds(region.id, "contained")).toEqual([contained.id]);
    expect(editor.queries.findRegionEntityIds(region.id, "boundary")).toEqual([boundary.id]);

    const feedback = createRegionMoveFeedback({
      phase: "preview",
      document: editor.document.getSnapshot(),
      movedEntities: [{
        ...contained,
        position: { x: 1, y: 0 },
      }],
      entityDefinitionMap: new Map(
        workspace.registry.entityDefinitions.map((candidate) => [candidate.id, candidate]),
      ),
    });
    expect(feedback).toEqual({
      phase: "preview",
      changes: [{
        regionId: region.id,
        enteredCount: 0,
        exitedCount: 1,
        boundaryCount: 1,
      }],
    });

    const regionBlueprint = createRegionBlueprintDocument({ workspace, regionId: region.id });
    expect(regionBlueprint?.entityOrder).toEqual([contained.id]);
    expect(regionBlueprint?.regions).toEqual([region]);

    editor.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: contained.id,
    });
    const ordinaryBlueprint = createSelectionBlueprintDocument({
      workspace,
      name: "普通蓝图",
    });
    expect(ordinaryBlueprint?.regions).toEqual([]);
  });

  it("places transformed regions atomically and keeps complete regions on partial success", () => {
    const workspace = createWorkspace();
    editor = createEditorHost(workspace);
    editor.internalDocument.setSnapshot(createDocument());

    const sourceRegion = {
      id: "source-region",
      name: "蓝图区",
      description: "",
      color: "#F59E0B",
      rects: [{ x: -1, y: -2, width: 3, height: 2 }],
    } as const;
    const blueprint = createBlueprintDocument({
      name: "含区域蓝图",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 0, y: 0 },
      entities: {
        belt: createEntity({
          id: "belt",
          definitionId: "belt_straight_1x1",
          x: 0,
          y: 0,
        }),
      },
      entityOrder: ["belt"],
      slotLinks: [],
      regions: [sourceRegion],
    });

    editor.actions.createBlueprintPlacementDraft!(blueprint, { x: 10, y: 10 });
    expect(editor.state.regionAnnotations.placementPreview[0]?.rects).toEqual([
      { x: 9, y: 8, width: 3, height: 2 },
    ]);
    editor.actions.rotateCollectionAroundPivotCell(EntityCollectionType.preview, 90);
    expect(editor.state.regionAnnotations.placementPreview[0]?.rects).toEqual([
      { x: 11, y: 9, width: 2, height: 3 },
    ]);
    expect(editor.actions.applyPlacementDraft()).toBe(true);

    const placed = editor.document.getSnapshot();
    const placedRegion = placed.regions[0];
    expect(Object.keys(placed.entities)).toHaveLength(1);
    expect(placedRegion?.id).not.toBe(sourceRegion.id);
    expect(placedRegion?.rects).toEqual([{ x: 11, y: 9, width: 2, height: 3 }]);
    expect(editor.state.history.records.at(-1)?.delta.regions?.after[0]?.id).toBe(placedRegion?.id);

    expect(editor.actions.undoDocumentHistory()).toBe(true);
    expect(Object.keys(editor.document.getSnapshot().entities)).toHaveLength(0);
    expect(editor.document.getSnapshot().regions).toEqual([]);
    expect(editor.actions.redoDocumentHistory()).toBe(true);
    expect(editor.document.getSnapshot().regions[0]?.id).toBe(placedRegion?.id);

    const partialBlueprint = createBlueprintDocument({
      name: "部分成功区域蓝图",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 0, y: 0 },
      entities: {
        inside: createEntity({
          id: "inside",
          definitionId: "belt_straight_1x1",
          x: 0,
          y: 0,
        }),
        outside: createEntity({
          id: "outside",
          definitionId: "belt_straight_1x1",
          x: 100,
          y: 0,
        }),
      },
      entityOrder: ["inside", "outside"],
      slotLinks: [],
      regions: [{
        ...sourceRegion,
        rects: [{ x: 0, y: 0, width: 101, height: 1 }],
      }],
    });
    editor.actions.createBlueprintPlacementDraft!(partialBlueprint, { x: 0, y: 0 });
    const entityCountBeforePartial = Object.keys(editor.document.getSnapshot().entities).length;
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    expect(Object.keys(editor.document.getSnapshot().entities)).toHaveLength(entityCountBeforePartial + 1);
    expect(editor.document.getSnapshot().regions.at(-1)?.rects).toEqual([
      { x: 0, y: 0, width: 101, height: 1 },
    ]);

    const rejectedBlueprint = createBlueprintDocument({
      name: "全部失败区域蓝图",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 0, y: 0 },
      entities: {
        outside: createEntity({
          id: "outside",
          definitionId: "belt_straight_1x1",
          x: 1_000,
          y: 1_000,
        }),
      },
      entityOrder: ["outside"],
      slotLinks: [],
      regions: [sourceRegion],
    });
    const regionCountBeforeRejected = editor.document.getSnapshot().regions.length;
    editor.actions.createBlueprintPlacementDraft!(rejectedBlueprint, { x: 0, y: 0 });
    expect(editor.actions.applyPlacementDraft()).toBe(false);
    expect(editor.document.getSnapshot().regions).toHaveLength(regionCountBeforeRejected);
    editor.actions.cancelPlacementDraft();
    expect(editor.state.regionAnnotations.placementPreview).toEqual([]);
  });
});
