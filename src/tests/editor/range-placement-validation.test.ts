import { afterEach, describe, expect, it } from "vitest";

import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import { createWorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EntityRangeDefinition } from "@/domain/registry/types/entity-range";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";

const BASE_ID = "wuling_protocol_core";
const SOURCE_ID = "test-range-source";
const DOUBLE_SOURCE_ID = "test-double-range-source";
const OVERLAP_REASON = "range-partial-overlap";
const OCCUPANCY_REASON = "range-forbidden-entity";

function entity(id: string, definitionId: string, x: number, y: number, rotation: WorldEntity["rotation"] = 0): WorldEntity {
  return { id, definitionId, position: { x, y }, rotation, tags: [], config: {} };
}

function createEditor() {
  const registry = createRegistryContract();
  const range = {
    id: "east",
    localRect: { x: 4, y: 0, width: 3, height: 3 },
    coverage: "intersects",
    visualId: "gas",
    placementRule: {
      groupId: "test-periodic",
      overlap: "disjoint-or-equal",
      allowedSegments: ["belt", "pipe"],
    },
  } satisfies EntityRangeDefinition;
  const template = registry.entityDefinitions.find((definition) => definition.id === "vaporizer_1")!;
  registry.entityDefinitions = [
    ...registry.entityDefinitions,
    { ...template, id: SOURCE_ID, footprint: { width: 1, height: 1 }, ranges: [range] },
    {
      ...template,
      id: DOUBLE_SOURCE_ID,
      footprint: { width: 1, height: 1 },
      ranges: [range, { ...range, id: "west", localRect: { ...range.localRect, x: -6 } }],
    },
  ];
  registry.queries = createRegistryQuery(registry);
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry,
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null, blueprintPlanner: null,
  };
  return createEditorTestHost(workspace);
}

function loadEntities(editor: ReturnType<typeof createEditor>, entities: readonly WorldEntity[]) {
  editor.internalDocument.setSnapshot({
    ...createWorldDocument({ baseId: BASE_ID }),
    entities: Object.fromEntries(entities.map((entry) => [entry.id, entry])),
    entityOrder: entities.map((entry) => entry.id),
  });
}

function rangeReasons(editor: ReturnType<typeof createEditor>, id: string) {
  return editor.queries.getEntityPlacementValidation(id).reasons
    .map((reason) => reason.code).filter((code) => code.startsWith("range-"));
}

afterEach(() => localStorage.clear());

describe("作用范围放置校验", () => {
  it("允许旋转后完全重合、接边及完全分离，部分相交时标记双方", () => {
    const editor = createEditor();
    try {
      const source = entity("source", SOURCE_ID, 10, 10);
      const equal = entity("equal", SOURCE_ID, 20, 12, 180);
      const touching = entity("touching", SOURCE_ID, 13, 10);
      const separate = entity("separate", SOURCE_ID, 10, 18);
      loadEntities(editor, [source, equal, touching, separate]);
      for (const entry of [source, equal, touching, separate]) {
        expect(rangeReasons(editor, entry.id)).toEqual([]);
      }

      loadEntities(editor, [source, { ...equal, position: { x: 20, y: 13 } }, touching, separate]);
      expect(rangeReasons(editor, "source")).toEqual([OVERLAP_REASON]);
      expect(rangeReasons(editor, "equal")).toEqual([OVERLAP_REASON]);
      expect(rangeReasons(editor, "touching")).toEqual([]);
      expect(rangeReasons(editor, "separate")).toEqual([]);
    } finally {
      editor.dispose();
    }
  });

  it("阻挡高级来源的一侧会标记整台设备，另一侧的独立来源及物流节仍有效", () => {
    const editor = createEditor();
    try {
      const advanced = entity("advanced", DOUBLE_SOURCE_ID, 14, 10);
      const west = entity("west", SOURCE_ID, 4, 10);
      const belt = entity("belt", "belt_straight_1x1", 18, 10);
      const pipe = entity("pipe", "pipe_straight_1x1", 18, 11);
      const blocker = entity("blocker", "grinder_1", 19, 12);
      const entries = [advanced, west, belt, pipe, blocker];
      for (const orderedEntries of [entries, [...entries].reverse()]) {
        loadEntities(editor, orderedEntries);
        expect(rangeReasons(editor, "advanced")).toEqual([OCCUPANCY_REASON]);
        expect(rangeReasons(editor, "blocker")).toEqual([OCCUPANCY_REASON]);
        for (const id of ["west", "belt", "pipe"]) expect(rangeReasons(editor, id)).toEqual([]);
        expect(editor.state.collections[EntityCollectionType.invalidPlacement]).toEqual(expect.arrayContaining(["advanced", "blocker"]));
        expect(editor.document.getSnapshot().entities.blocker).toBeDefined();
      }

      loadEntities(editor, [advanced, west, belt, pipe]);
      expect(rangeReasons(editor, "advanced")).toEqual([]);
      expect(editor.state.collections[EntityCollectionType.invalidPlacement]).not.toContain("advanced");
    } finally {
      editor.dispose();
    }
  });

  it("校验草稿范围对正式设备及正式范围对草稿设备，取消和提交后更新缓存", () => {
    const editor = createEditor();
    try {
      const blocker = entity("blocker", "grinder_1", 14, 10);
      loadEntities(editor, [blocker]);
      editor.actions.createSinglePlacementDraft({ definitionId: SOURCE_ID, centerGridPoint: { x: 10, y: 10 } });
      const sourceDraft = editor.state.collections.preview[0]!;
      expect(rangeReasons(editor, sourceDraft)).toEqual([OCCUPANCY_REASON]);
      expect(rangeReasons(editor, "blocker")).toEqual([OCCUPANCY_REASON]);
      editor.actions.cancelPlacementDraft();
      expect(rangeReasons(editor, "blocker")).toEqual([]);

      loadEntities(editor, [entity("source", SOURCE_ID, 10, 10)]);
      editor.actions.createSinglePlacementDraft({ definitionId: blocker.definitionId, centerGridPoint: { x: 15, y: 11 } });
      const blockerDraft = editor.state.collections.preview[0]!;
      expect(rangeReasons(editor, blockerDraft)).toEqual([OCCUPANCY_REASON]);
      expect(rangeReasons(editor, "source")).toEqual([OCCUPANCY_REASON]);
      expect(editor.actions.applyPlacementDraft()).toBe(true);
      expect(rangeReasons(editor, "source")).toEqual([OCCUPANCY_REASON]);
    } finally {
      editor.dispose();
    }
  });

  it("校验同批蓝图草稿之间的范围与占用，并保留提交后的非法布局", () => {
    const editor = createEditor();
    try {
      loadEntities(editor, []);
      const entries = [
        entity("source", SOURCE_ID, 10, 10),
        entity("equal", SOURCE_ID, 20, 12, 180),
        entity("blocker", "grinder_1", 14, 10),
      ];
      editor.actions.createBlueprintPlacementDraft?.(createBlueprintDocument({
        name: "测试作用范围",
        baseId: BASE_ID,
        initialGridPoint: { x: 10, y: 10 },
        entities: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
        entityOrder: entries.map((entry) => entry.id),
        slotLinks: [],
      }), { x: 10, y: 10 });

      const drafts = [...editor.state.collections.preview];
      expect(drafts).toHaveLength(3);
      for (const id of drafts) expect(rangeReasons(editor, id)).toEqual([OCCUPANCY_REASON]);
      expect(editor.actions.applyPlacementDraft()).toBe(true);
      const definitionIds = new Set(entries.map((entry) => entry.definitionId));
      const committed = Object.values(editor.document.getSnapshot().entities)
        .filter((entry) => definitionIds.has(entry.definitionId));
      expect(committed).toHaveLength(3);
      for (const { id } of committed) expect(rangeReasons(editor, id)).toEqual([OCCUPANCY_REASON]);
    } finally {
      editor.dispose();
    }
  });
});
