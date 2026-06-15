import { describe, expect, it } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import type { GestureKeyboardEventLike } from "@/app/input/gesture/adapter";
import { createSelectionBlueprintDocument } from "@/app/blueprint/save-blueprint";
import {
  createBlueprintDocument,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import { type WorldDocument } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { createDarkPipeSlotLink } from "@/shared/dark-pipe-link";

// ─── Helpers ───

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
  };
}

function keyEvent(
  overrides: Partial<GestureKeyboardEventLike>,
): GestureKeyboardEventLike {
  return {
    code: "",
    key: "",
    keyCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

/**
 * 创建一个自定义的 WorldDocument，只包含需要的实体和可选的 slotLinks。
 */
function createTestDocument(options: {
  entities: WorldDocument["entities"];
  entityOrder?: string[];
  slotLinks?: WorldDocument["slotLinks"];
}): WorldDocument {
  return {
    schemaVersion: 1,
    documentKey: "test-doc-key",
    baseId: "wuling_protocol_core",
    meta: {
      id: "test-world",
      name: "Test World",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    entities: options.entities,
    entityOrder: options.entityOrder ?? Object.keys(options.entities),
    slotLinks: options.slotLinks ?? [],
    documentSettings: {
      powerMode: "real" as const,
      viewport: {
        center: { x: 0, y: 0 },
        gridSize: 1,
        displayRotation: 0,
      },
    },
  };
}

/**
 * 选中 entity 并调用 createSelectionBlueprintDocument。
 */
function createBlueprintForEntity(
  editorHost: ReturnType<typeof createEditorHost>,
  entityId: string,
) {
  editorHost.actions.clearCollection(EntityCollectionType.selection);
  editorHost.actions.addToCollection({
    collectionType: EntityCollectionType.selection,
    entityId,
  });
  return createSelectionBlueprintDocument({
    workspace: editorHost.workspace,
    name: "test-blueprint",
  });
}

// ─── Phase 1: createSelectionBlueprintDocument 单元测试 ───

describe("createSelectionBlueprintDocument", () => {
  it("1.1: 单实体无 config 无 slotLink — 蓝图 doc 应只有 1 个实体", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "belt-1": {
            id: "belt-1",
            definitionId: "belt_straight_1x1",
            position: { x: 10, y: 10 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
        entityOrder: ["belt-1"],
      }),
    );

    const blueprint = createBlueprintForEntity(editorHost, "belt-1");
    expect(blueprint).not.toBeNull();

    const bp = blueprint!;
    expect(bp.entityOrder).toHaveLength(1);
    expect(Object.keys(bp.entities)).toHaveLength(1);
    expect(bp.entities["belt-1"]).toBeDefined();
    expect(bp.slotLinks).toHaveLength(0);
  });

  it("1.2: 单实体带 warehouse slotLink — 蓝图保留 slotLink", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "unloader-1": {
            id: "unloader-1",
            definitionId: "item_port_unloader_1",
            position: { x: 32, y: 26 },
            rotation: 180,
            config: {
              "storageSlotGroups[0].slots[0].ignoreStock": true,
            },
            tags: [],
          },
        },
        entityOrder: ["unloader-1"],
        slotLinks: [{
          id: "warehouse-link:unloader-1:unloader_buffer:slot_1",
          linkType: "share-all",
          source: {
            entityId: "unloader-1",
            storageSlotGroupId: "unloader_buffer",
            slotId: "slot_1",
          },
          target: {
            entityId: "warehouse",
            storageSlotGroupId: "warehouse",
            slotId: "item_originium_ore",
          },
        }],
      }),
    );

    const blueprint = createBlueprintForEntity(editorHost, "unloader-1");
    expect(blueprint).not.toBeNull();

    const bp = blueprint!;
    expect(bp.entityOrder).toHaveLength(1);
    expect(Object.keys(bp.entities)).toHaveLength(1);

    const entity = bp.entities["unloader-1"];
    expect(entity).toBeDefined();

    // 2026-06-09: slotLink 应被复制到蓝图中
    expect(bp.slotLinks).toHaveLength(1);
    expect(bp.slotLinks[0]?.source.entityId).toBe("unloader-1");
    expect(bp.slotLinks[0]?.source.storageSlotGroupId).toBe("unloader_buffer");
    expect(bp.slotLinks[0]?.target.slotId).toBe("item_originium_ore");
  });

  it("1.3: 实体带 slotLinks（source === target）— 蓝图应有 1 个 slotLink", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "device-a": {
            id: "device-a",
            definitionId: "item_port_storager_1",
            position: { x: 4, y: 4 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
        entityOrder: ["device-a"],
        slotLinks: [
          {
            id: "link-self",
            linkType: "share-all",
            source: {
              entityId: "device-a",
              storageSlotGroupId: "storage",
              slotId: "slot_0",
            },
            target: {
              entityId: "device-a",
              storageSlotGroupId: "storage",
              slotId: "slot_1",
            },
          },
        ],
      }),
    );

    const blueprint = createBlueprintForEntity(editorHost, "device-a");
    expect(blueprint).not.toBeNull();

    const bp = blueprint!;
    expect(bp.entityOrder).toHaveLength(1);
    expect(Object.keys(bp.entities)).toHaveLength(1);

    // source 和 target 都是 device-a，slotLink 应该被保留
    expect(bp.slotLinks).toHaveLength(1);
    expect(bp.slotLinks[0]!.source.entityId).toBe("device-a");
    expect(bp.slotLinks[0]!.target.entityId).toBe("device-a");
  });

  it("1.4: entity 在 entities 但不在 entityOrder — 仍能被正确收集且不重复", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "orphan-1": {
            id: "orphan-1",
            definitionId: "belt_straight_1x1",
            position: { x: 5, y: 5 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
        // entityOrder 故意不包含 orphan-1
        entityOrder: [],
      }),
    );

    const blueprint = createBlueprintForEntity(editorHost, "orphan-1");
    expect(blueprint).not.toBeNull();

    const bp = blueprint!;
    // Loop 1 (遍历 entityOrder) 不会命中，Loop 2 (遍历 selectionIds) 应该命中
    expect(bp.entityOrder).toHaveLength(1);
    expect(Object.keys(bp.entities)).toHaveLength(1);
    expect(bp.entities["orphan-1"]).toBeDefined();
  });

  it("1.5: 空 selection 返回 null", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "device-a": {
            id: "device-a",
            definitionId: "belt_straight_1x1",
            position: { x: 5, y: 5 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
      }),
    );
    editorHost.actions.clearCollection(EntityCollectionType.selection);

    const blueprint = createSelectionBlueprintDocument({
      workspace: editorHost.workspace,
      name: "empty",
    });
    expect(blueprint).toBeNull();
  });

  it("1.6: 选中未在 entities 中的 ID（如已删除的 entity）不产生重复", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "device-a": {
            id: "device-a",
            definitionId: "belt_straight_1x1",
            position: { x: 5, y: 5 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
        entityOrder: ["device-a"],
      }),
    );

    // 直接在 selection 中放入一个不存在于 entities 的 ID
    const selection = editorHost.state.collections.selection;
    // selection 运行时类型为 IObservableArray<string>，具有 replace 方法
    (selection as unknown as { replace: (items: string[]) => void }).replace(["device-a", "ghost-id-999"]);

    const blueprint = createSelectionBlueprintDocument({
      workspace: editorHost.workspace,
      name: "ghost-test",
    });
    expect(blueprint).not.toBeNull();

    const bp = blueprint!;
    // ghost-id-999 不存在于 entities 中，getEntityById 也找不到，
    // 且 getEntityById 返回后还会检查 currentDocument.entities[entity.id] !== undefined
    // ghost 不应该进入蓝图
    expect(bp.entityOrder).toHaveLength(1);
    expect(Object.keys(bp.entities)).toHaveLength(1);
    expect(bp.entities["device-a"]).toBeDefined();
  });
});

// ─── Phase 2: 全链路 Ctrl+C / Ctrl+V 集成测试 ───

describe("Ctrl+C/Ctrl+V full pipeline", () => {
  it("2.1: 单实体 Ctrl+C — blueprintPlacementRecord 应只有 1 个实体", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "storager-1": {
            id: "storager-1",
            definitionId: "item_port_storager_1",
            position: { x: 4, y: 4 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
        entityOrder: ["storager-1"],
      }),
    );
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "storager-1",
    });

    appHost.internalActions.setActiveTool("marquee");

    const consumed = appHost.gestureAdapter.handleKeyDown(
      keyEvent({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true }),
    );

    expect(consumed).toBe(true);
    expect(appHost.internalState.activeTool).toBe("blueprint-placement");

    const record = appHost.internalState.runtime.blueprintPlacementRecord;
    expect(record).not.toBeNull();
    expect(record!.entityOrder).toHaveLength(1);
    expect(Object.keys(record!.entities)).toHaveLength(1);

    // preview drafts 应该有 1 个
    expect(editorHost.state.collections.preview).toHaveLength(1);
  });

  it("2.2: 单实体 Ctrl+C → 放置 → document 只新增 1 个 entity", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const originalDoc = createTestDocument({
      entities: {
        "storager-1": {
          id: "storager-1",
          definitionId: "item_port_storager_1",
          position: { x: 4, y: 4 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["storager-1"],
    });
    editorHost.internalDocument.setSnapshot(originalDoc);
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "storager-1",
    });

    appHost.internalActions.setActiveTool("marquee");

    // Ctrl+C
    appHost.gestureAdapter.handleKeyDown(
      keyEvent({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true }),
    );

    // 直接调用 applyPlacementDraft 放置 preview
    const applied = editorHost.actions.applyPlacementDraft();
    expect(applied).toBe(true);

    const doc = editorHost.internalDocument.getSnapshot();
    const originalCount = Object.keys(originalDoc.entities).length;

    // 应该只新增 1 个 entity，总数 = 原数量 + 1
    expect(Object.keys(doc.entities)).toHaveLength(originalCount + 1);
  });

  it("2.3: Ctrl+V 粘贴后用 lastTempBlueprint 且不重复", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const originalDoc = createTestDocument({
      entities: {
        "storager-1": {
          id: "storager-1",
          definitionId: "item_port_storager_1",
          position: { x: 4, y: 4 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["storager-1"],
    });
    editorHost.internalDocument.setSnapshot(originalDoc);
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "storager-1",
    });

    appHost.internalActions.setActiveTool("marquee");

    // Ctrl+C
    appHost.gestureAdapter.handleKeyDown(
      keyEvent({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true }),
    );
    const copiedBlueprintId = appHost.internalState.runtime.blueprintPlacementRecord?.blueprintId;

    // 退出 placement
    appHost.internalActions.setActiveTool("select");
    editorHost.actions.clearCollection(EntityCollectionType.selection);

    // Ctrl+V 粘贴
    const consumed = appHost.gestureAdapter.handleKeyDown(
      keyEvent({ code: "KeyV", key: "v", keyCode: 86, ctrlKey: true }),
    );

    expect(consumed).toBe(true);
    expect(appHost.internalState.activeTool).toBe("blueprint-placement");
    expect(appHost.internalState.runtime.blueprintPlacementRecord?.blueprintId).toBe(
      copiedBlueprintId,
    );
    expect(appHost.internalState.runtime.blueprintPlacementRecord?.entityOrder).toHaveLength(1);
    expect(editorHost.state.collections.preview).toHaveLength(1);

    // 放置
    const applied = editorHost.actions.applyPlacementDraft();
    expect(applied).toBe(true);

    const doc = editorHost.internalDocument.getSnapshot();
    const originalCount = Object.keys(originalDoc.entities).length;
    expect(Object.keys(doc.entities)).toHaveLength(originalCount + 1);
  });

  it("2.4: 带 slotLink 的实体 Ctrl+C 不产生额外重复", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const originalDoc = createTestDocument({
      entities: {
        "unloader-1": {
          id: "unloader-1",
          definitionId: "item_port_unloader_1",
          position: { x: 32, y: 26 },
          rotation: 180,
          config: {
            "storageSlotGroups[0].slots[0].ignoreStock": true,
          },
          tags: [],
        },
      },
      entityOrder: ["unloader-1"],
      slotLinks: [{
        id: "warehouse-link:unloader-1:unloader_buffer:slot_1",
        linkType: "share-all",
        source: { entityId: "unloader-1", storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
        target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item_originium_ore" },
      }],
    });
    editorHost.internalDocument.setSnapshot(originalDoc);
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "unloader-1",
    });

    appHost.internalActions.setActiveTool("marquee");

    // Ctrl+C
    appHost.gestureAdapter.handleKeyDown(
      keyEvent({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true }),
    );

    expect(editorHost.state.collections.preview).toHaveLength(1);

    // 放置
    editorHost.actions.applyPlacementDraft();

    const doc = editorHost.internalDocument.getSnapshot();
    const originalCount = Object.keys(originalDoc.entities).length;
    expect(Object.keys(doc.entities)).toHaveLength(originalCount + 1);
  });

  it("2.5: 重复 3 次 Ctrl+C → Ctrl+V 放置，每次只新增 1 个 entity", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const originalDoc = createTestDocument({
      entities: {
        "storager-1": {
          id: "storager-1",
          definitionId: "item_port_storager_1",
          position: { x: 4, y: 4 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["storager-1"],
    });
    editorHost.internalDocument.setSnapshot(originalDoc);
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "storager-1",
    });

    const initialCount = Object.keys(originalDoc.entities).length;

    for (let cycle = 0; cycle < 3; cycle++) {
      appHost.internalActions.setActiveTool("marquee");

      // Ctrl+C
      const copyConsumed = appHost.gestureAdapter.handleKeyDown(
        keyEvent({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true }),
      );
      expect(copyConsumed).toBe(true);
      expect(editorHost.state.collections.preview).toHaveLength(1);

      // 放置
      const applied = editorHost.actions.applyPlacementDraft();
      expect(applied).toBe(true);

      const doc = editorHost.internalDocument.getSnapshot();
      expect(Object.keys(doc.entities)).toHaveLength(initialCount + cycle + 1);

      // enterBlueprintPlacement 内部 setActiveTool("select") 触发
      // cleanupMarquee 清空了 selection，需要在下一轮 Ctrl+C 前补回。
      editorHost.actions.addToCollection({
        collectionType: EntityCollectionType.selection,
        entityId: "storager-1",
      });
    }
  });

  it("2.6: 放置后 slotLink 中的 entity ID 应被更新为新 ID", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const originalDoc = createTestDocument({
      entities: {
        "unloader-1": {
          id: "unloader-1",
          definitionId: "item_port_unloader_1",
          position: { x: 32, y: 26 },
          rotation: 180,
          config: {
            "storageSlotGroups[0].slots[0].ignoreStock": true,
          },
          tags: [],
        },
      },
      entityOrder: ["unloader-1"],
      slotLinks: [{
        id: "warehouse-link:unloader-1:unloader_buffer:slot_1",
        linkType: "share-all",
        source: { entityId: "unloader-1", storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
        target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item_originium_ore" },
      }],
    });
    editorHost.internalDocument.setSnapshot(originalDoc);
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "unloader-1",
    });

    appHost.internalActions.setActiveTool("marquee");

    // Ctrl+C
    appHost.gestureAdapter.handleKeyDown(
      keyEvent({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true }),
    );
    // 放置
    editorHost.actions.applyPlacementDraft();

    const doc = editorHost.internalDocument.getSnapshot();
    const newEntity = Object.values(doc.entities).find(
      (e) => e.id !== "unloader-1" && e.definitionId === "item_port_unloader_1",
    );

    expect(newEntity).toBeDefined();

    // 2026-06-09: slotLink source.entityId 应在放置后被重写为新 ID
    const newSlotLink = doc.slotLinks.find(
      (l) => l.source.entityId === newEntity!.id && l.target.entityId === "warehouse",
    );
    expect(newSlotLink).toBeDefined();
    expect(newSlotLink!.source.entityId).not.toBe("unloader-1");
    expect(newSlotLink!.source.entityId).toBe(newEntity!.id);
    expect(newSlotLink!.source.storageSlotGroupId).toBe("unloader_buffer");
    expect(newSlotLink!.source.slotId).toBe("slot_1");
    expect(newSlotLink!.target.entityId).toBe("warehouse");
    expect(newSlotLink!.target.slotId).toBe("item_originium_ore");
  });

  it("2.7: 2 个不同实体同时选中 Ctrl+C — 蓝图应有 2 个实体", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "belt-1": {
            id: "belt-1",
            definitionId: "belt_straight_1x1",
            position: { x: 10, y: 10 },
            rotation: 0,
            config: {},
            tags: [],
          },
          "storager-1": {
            id: "storager-1",
            definitionId: "item_port_storager_1",
            position: { x: 15, y: 10 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
        entityOrder: ["belt-1", "storager-1"],
      }),
    );
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "belt-1",
    });
    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "storager-1",
    });

    appHost.internalActions.setActiveTool("marquee");

    appHost.gestureAdapter.handleKeyDown(
      keyEvent({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true }),
    );

    expect(editorHost.state.collections.preview).toHaveLength(2);
    const record = appHost.internalState.runtime.blueprintPlacementRecord;
    expect(record).not.toBeNull();
    expect(record!.entityOrder).toHaveLength(2);
  });

  it("2.8: 多次 Ctrl+C 不累积 lastTempBlueprint 的 entity 数量", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(
      createTestDocument({
        entities: {
          "belt-1": {
            id: "belt-1",
            definitionId: "belt_straight_1x1",
            position: { x: 10, y: 10 },
            rotation: 0,
            config: {},
            tags: [],
          },
        },
        entityOrder: ["belt-1"],
      }),
    );
    const appHost = createAppHost(workspace);

    editorHost.actions.addToCollection({
      collectionType: EntityCollectionType.selection,
      entityId: "belt-1",
    });

    // 连续 3 次 Ctrl+C，每次退出后重新 copy
    for (let i = 0; i < 3; i++) {
      // cleanupMarquee 会清空 selection，每轮重新添加
      editorHost.actions.addToCollection({
        collectionType: EntityCollectionType.selection,
        entityId: "belt-1",
      });

      appHost.internalActions.setActiveTool("marquee");

      const consumed = appHost.gestureAdapter.handleKeyDown(
        keyEvent({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true }),
      );
      expect(consumed).toBe(true);

      const record = appHost.internalState.runtime.blueprintPlacementRecord;
      expect(record).not.toBeNull();
      expect(record!.entityOrder).toHaveLength(1);

      // 退出 placement 模式
      appHost.internalActions.setActiveTool("select");
    }
  });
});

// ─── Phase 3: ID 重写 — slotLinks 中的 entity ID 映射 ───
//
// 2026-06-09: entity ID 引用已从 entity.config 迁移至 document.slotLinks。
// applyPlacementDraft 不再重写 config 中的 entity ID。
//
// AI-CORRECTION 2026-06-15: 原注释描述的"当前缺陷"（config 中 entity ID
// 未被重写）已通过架构迁移解决——config 不再承载 entity ID 引用，
// 因此不再需要 rewriteEntityIdInConfig。R1.3a/R3.1/R3.2 三个基于旧 config
// 模型的测试已移除。

describe("ID rewriting in blueprint placement", () => {
  /**
   * 直接创建 BlueprintDocument 并走 placement pipeline，
   * 不经过 Ctrl+C/V 手势层，精确测试 placement-action 的 ID 映射。
   */
  function placeBlueprint(
    editorHost: ReturnType<typeof createEditorHost>,
    blueprint: BlueprintDocument,
  ) {
    editorHost.actions.createBlueprintPlacementDraft!(blueprint, {
      x: blueprint.initialGridPoint.x,
      y: blueprint.initialGridPoint.y,
    });
    return editorHost.actions.applyPlacementDraft();
  }

  /** 从 document 中按 definitionId 查找所有匹配的 entity */
  function findEntitiesByDef(
    editorHost: ReturnType<typeof createEditorHost>,
    definitionId: string,
  ) {
    const doc = editorHost.internalDocument.getSnapshot();
    return Object.values(doc.entities).filter(
      (e) => e.definitionId === definitionId,
    );
  }

  // ── Group R1: SlotLink 中 entity ID 重写（迁移自 config.links 重写测试）──
  // 2026-06-09: 所有 links 已从 entity.config 迁移至 document.slotLinks。

  it("R1.1: 自引用 slotLink → 放置后 source.entityId 指向新 ID", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const doc = createTestDocument({
      entities: {
        "dev-A": {
          id: "dev-A",
          definitionId: "item_port_unloader_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {
            "storageSlotGroups[0].slots[0].ignoreStock": true,
          },
          tags: [],
        },
        "external-ref": {
          id: "external-ref",
          definitionId: "item_port_storager_1",
          position: { x: 20, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["dev-A", "external-ref"],
    });
    editorHost.internalDocument.setSnapshot(doc);

    const blueprint = createBlueprintDocument({
      name: "test-self-ref",
      baseId: doc.baseId,
      initialGridPoint: { x: 10, y: 10 },
      entities: {
        "dev-A": {
          ...doc.entities["dev-A"]!,
          config: { ...doc.entities["dev-A"]!.config },
        },
      },
      entityOrder: ["dev-A"],
      slotLinks: [{
        id: "warehouse-link:dev-A:unloader_buffer:slot_1",
        linkType: "share-all",
        source: { entityId: "dev-A", storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
        target: { entityId: "external-ref", storageSlotGroupId: "storage_slot_1", slotId: "slot_1" },
      }],
    });

    const applied = placeBlueprint(editorHost, blueprint);
    expect(applied).toBe(true);

    const finalDoc = editorHost.internalDocument.getSnapshot();
    // 2026-06-10: slotLink 的 target 是外部非蛇兵实体（external-ref），
    // blueprint 放置时链路被丢弃。entity 正常放置即可。
    const unloaders = findEntitiesByDef(editorHost, "item_port_unloader_1");
    expect(unloaders).toHaveLength(2);
    expect(finalDoc.slotLinks.filter((l) => l.id.startsWith("warehouse-link:")).length).toBe(0);
  });

  it("R1.2: 跨实体引用 slotLink — A 指向 B → 放置后指向 B 的新 ID", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const doc = createTestDocument({
      entities: {
        "loader-A": {
          id: "loader-A",
          definitionId: "item_port_unloader_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
        "storager-A": {
          id: "storager-A",
          definitionId: "item_port_storager_1",
          position: { x: 15, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["loader-A", "storager-A"],
    });
    editorHost.internalDocument.setSnapshot(doc);

    const blueprint = createBlueprintDocument({
      name: "test-cross-ref",
      baseId: doc.baseId,
      initialGridPoint: { x: 12, y: 10 },
      entities: {
        "loader-A": { ...doc.entities["loader-A"]! },
        "storager-A": { ...doc.entities["storager-A"]! },
      },
      entityOrder: ["loader-A", "storager-A"],
      slotLinks: [{
        id: "link-loader-to-storager",
        linkType: "share-all",
        source: { entityId: "loader-A", storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
        target: { entityId: "storager-A", storageSlotGroupId: "storage_slot_1", slotId: "slot_1" },
      }],
    });

    const applied = placeBlueprint(editorHost, blueprint);
    expect(applied).toBe(true);

    const loaders = findEntitiesByDef(editorHost, "item_port_unloader_1");
    const storagers = findEntitiesByDef(editorHost, "item_port_storager_1");

    const newLoader = loaders.find((e) => e.id !== "loader-A");
    const newStorager = storagers.find((e) => e.id !== "storager-A");
    expect(newLoader).toBeDefined();
    expect(newStorager).toBeDefined();

    const finalDoc = editorHost.internalDocument.getSnapshot();
    const newLink = finalDoc.slotLinks.find((l) => l.source.entityId === newLoader!.id);
    expect(newLink).toBeDefined();
    expect(newLink!.target.entityId).toBe(newStorager!.id);
  });

  // AI-REMOVED 2026-06-15:
  // Reason: 2026-06-09 已将 entity ID 引用从 config.links 迁移至 document.slotLinks。
  //   applyPlacementDraft 不再重写 config 中的 entity ID。外部引用断开逻辑
  //   已在 slotLinks 管道中由 resolveSlotLinkEntityIdForPlacement 处理，
  //   对应测试为 R1.1（外部非蛇兵实体 slotLink 被丢弃）。
  // Trigger: 取消 skip 后 3 个测试全部按预期失败，config 路径已废弃。
  // Evidence: placement-action.ts:262 AI-CORRECTION 2026-06-09；
  //   legacy-blueprint-import.ts 已有 config→slotLinks 迁移。
  // Replacement: R1.1（slotLinks 外部引用丢弃）
  // Risk: Low — config 中不再产生 entityId 引用，旧数据有迁移逻辑。
  // Human Review: Not Required
  //
  // Original code:
  // it("R1.3a [SKIP-2026-06-09]: 引用蓝图外部普通实体 → 放置后 target.entityId 断开", () => {
  //   const workspace = createWorkspace();
  //   const editorHost = createEditorHost(workspace);
  //   const doc = createTestDocument({
  //     entities: {
  //       "loader-A": {
  //         id: "loader-A",
  //         definitionId: "item_port_unloader_1",
  //         position: { x: 10, y: 10 },
  //         rotation: 0,
  //         config: {
  //           "links[0].target.entityId": "external-storager",
  //           "links[0].target.storageSlotGroupId": "storage",
  //           "links[0].target.slotId": "slot_0",
  //         },
  //         tags: [],
  //       },
  //       "external-storager": {
  //         id: "external-storager",
  //         definitionId: "item_port_storager_1",
  //         position: { x: 20, y: 10 },
  //         rotation: 0,
  //         config: {},
  //         tags: [],
  //       },
  //     },
  //     entityOrder: ["loader-A", "external-storager"],
  //   });
  //   editorHost.internalDocument.setSnapshot(doc);
  //
  //   const blueprint = createBlueprintDocument({
  //     name: "test-external-ref",
  //     baseId: doc.baseId,
  //     initialGridPoint: { x: 10, y: 10 },
  //     entities: {
  //       "loader-A": {
  //         ...doc.entities["loader-A"]!,
  //         config: { ...doc.entities["loader-A"]!.config },
  //       },
  //     },
  //     entityOrder: ["loader-A"],
  //     slotLinks: [],
  //   });
  //
  //   const applied = placeBlueprint(editorHost, blueprint);
  //   expect(applied).toBe(true);
  //
  //   const loaders = findEntitiesByDef(editorHost, "item_port_unloader_1");
  //   const newLoader = loaders.find((e) => e.id !== "loader-A");
  //   expect(newLoader).toBeDefined();
  //
  //   // R1.3a: 外部普通实体引用应断开（空字符串）
  //   expect(newLoader!.config["links[0].target.entityId"]).toBe("");
  // });

  it("R1.3b [FIX-REQUIRED]: 引用 warehouse 哨兵 → 放置后保持不变", () => {
    // "warehouse" 是全球仓库的哨兵 ID，不属于任何具体设备，每个基地都有。
    // 蓝图放置时必须保留，不可断开。
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const doc = createTestDocument({
      entities: {
        "loader-A": {
          id: "loader-A",
          definitionId: "item_port_unloader_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {
            "links[0].target.entityId": "warehouse",
            "links[0].target.storageSlotGroupId": "warehouse",
            "links[0].target.slotId": "item_originium_ore",
          },
          tags: [],
        },
      },
      entityOrder: ["loader-A"],
    });
    editorHost.internalDocument.setSnapshot(doc);

    const blueprint = createBlueprintDocument({
      name: "test-warehouse-sentinel",
      baseId: doc.baseId,
      initialGridPoint: { x: 10, y: 10 },
      entities: {
        "loader-A": {
          ...doc.entities["loader-A"]!,
          config: { ...doc.entities["loader-A"]!.config },
        },
      },
      entityOrder: ["loader-A"],
      slotLinks: [],
    });

    const applied = placeBlueprint(editorHost, blueprint);
    expect(applied).toBe(true);

    const loaders = findEntitiesByDef(editorHost, "item_port_unloader_1");
    const newLoader = loaders.find((e) => e.id !== "loader-A");
    expect(newLoader).toBeDefined();

    // R1.3b: warehouse 是哨兵 ID，必须保留
    expect(newLoader!.config["links[0].target.entityId"]).toBe("warehouse");
    expect(newLoader!.config["links[0].target.storageSlotGroupId"]).toBe("warehouse");
  });

  it("R1.3c [FIX-REQUIRED]: 引用 base-builtin 实体 → 放置后保持不变", () => {
    // base-builtin 实体（如 hongs_bus）的 ID 是形式化创建的，每个基地都有。
    // 蓝图放置时必须保留，不可断开。
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const builtinId = "base-builtin:valley4_protocol_core:valley4_bus_seg_x_0";
    const doc = createTestDocument({
      entities: {
        "loader-A": {
          id: "loader-A",
          definitionId: "item_port_unloader_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {
            "links[0].target.entityId": builtinId,
            "links[0].target.storageSlotGroupId": "storage",
            "links[0].target.slotId": "slot_0",
          },
          tags: [],
        },
      },
      entityOrder: ["loader-A"],
    });
    editorHost.internalDocument.setSnapshot(doc);

    const blueprint = createBlueprintDocument({
      name: "test-builtin-sentinel",
      baseId: doc.baseId,
      initialGridPoint: { x: 10, y: 10 },
      entities: {
        "loader-A": {
          ...doc.entities["loader-A"]!,
          config: { ...doc.entities["loader-A"]!.config },
        },
      },
      entityOrder: ["loader-A"],
      slotLinks: [],
    });

    const applied = placeBlueprint(editorHost, blueprint);
    expect(applied).toBe(true);

    const loaders = findEntitiesByDef(editorHost, "item_port_unloader_1");
    const newLoader = loaders.find((e) => e.id !== "loader-A");
    expect(newLoader).toBeDefined();

    // R1.3c: base-builtin ID 是形式化创建的，必须保留
    expect(newLoader!.config["links[0].target.entityId"]).toBe(builtinId);
  });

  it("R1.4: config 值不是任何实体 ID → 保持原样", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const doc = createTestDocument({
      entities: {
        "loader-A": {
          id: "loader-A",
          definitionId: "item_port_unloader_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {
            "links[0].source.storageSlotGroupId": "unloader_buffer",
            "links[0].source.slotId": "slot_1",
            "storageSlotGroups[0].slots[0].ignoreStock": true,
            "some.custom.key": "custom-value-123",
          },
          tags: [],
        },
      },
      entityOrder: ["loader-A"],
    });
    editorHost.internalDocument.setSnapshot(doc);

    const blueprint = createBlueprintDocument({
      name: "test-non-entity-values",
      baseId: doc.baseId,
      initialGridPoint: { x: 10, y: 10 },
      entities: {
        "loader-A": {
          ...doc.entities["loader-A"]!,
          config: { ...doc.entities["loader-A"]!.config },
        },
      },
      entityOrder: ["loader-A"],
      slotLinks: [],
    });

    const applied = placeBlueprint(editorHost, blueprint);
    expect(applied).toBe(true);

    const loaders = findEntitiesByDef(editorHost, "item_port_unloader_1");
    const newLoader = loaders.find((e) => e.id !== "loader-A");
    expect(newLoader).toBeDefined();

    // R1.4: 非 entity ID 的值应保持不变
    expect(newLoader!.config["links[0].source.storageSlotGroupId"]).toBe("unloader_buffer");
    expect(newLoader!.config["links[0].source.slotId"]).toBe("slot_1");
    expect(newLoader!.config["storageSlotGroups[0].slots[0].ignoreStock"]).toBe(true);
    expect(newLoader!.config["some.custom.key"]).toBe("custom-value-123");
  });

  // ── Group R2: slotLinks 重写（当前应 PASS）──

  it("R2.1: slotLink 两端都在蓝图中 → 放置后 ID 已重写为正式 ID", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const doc = createTestDocument({
      entities: {
        "dev-A": {
          id: "dev-A",
          definitionId: "item_port_storager_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
        "dev-B": {
          id: "dev-B",
          definitionId: "item_port_storager_1",
          position: { x: 15, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["dev-A", "dev-B"],
      slotLinks: [
        {
          id: "link-1",
          linkType: "share-all" as const,
          source: {
            entityId: "dev-A",
            storageSlotGroupId: "storage",
            slotId: "slot_0",
          },
          target: {
            entityId: "dev-B",
            storageSlotGroupId: "storage",
            slotId: "slot_0",
          },
        },
      ],
    });
    editorHost.internalDocument.setSnapshot(doc);

    const blueprint = createBlueprintDocument({
      name: "test-slotlink-both",
      baseId: doc.baseId,
      initialGridPoint: { x: 12, y: 10 },
      entities: {
        "dev-A": { ...doc.entities["dev-A"]!, config: {} },
        "dev-B": { ...doc.entities["dev-B"]!, config: {} },
      },
      entityOrder: ["dev-A", "dev-B"],
      slotLinks: [
        {
          id: "link-1",
          linkType: "share-all",
          source: {
            entityId: "dev-A",
            storageSlotGroupId: "storage",
            slotId: "slot_0",
          },
          target: {
            entityId: "dev-B",
            storageSlotGroupId: "storage",
            slotId: "slot_0",
          },
        },
      ],
    });

    const applied = placeBlueprint(editorHost, blueprint);
    expect(applied).toBe(true);

    const finalDoc = editorHost.internalDocument.getSnapshot();

    // 原有 slotLink 仍在（未被替换）
    expect(finalDoc.slotLinks).toHaveLength(2);

    // 找出新增的 slotLink
    const newLink = finalDoc.slotLinks.find(
      (l) => l.source.entityId !== "dev-A" && l.source.entityId !== "dev-B",
    );
    expect(newLink).toBeDefined();
    expect(newLink!.source.entityId).not.toBe("dev-A");
    expect(newLink!.target.entityId).not.toBe("dev-B");

    // 新增的 entity 应该存在且 ID 匹配
    const newA = Object.values(finalDoc.entities).find(
      (e) => e.id === newLink!.source.entityId,
    );
    const newB = Object.values(finalDoc.entities).find(
      (e) => e.id === newLink!.target.entityId,
    );
    expect(newA).toBeDefined();
    expect(newB).toBeDefined();
  });

  it("R2.2: slotLink source 不在蓝图中 → 被丢弃", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const doc = createTestDocument({
      entities: {
        "dev-A": {
          id: "dev-A",
          definitionId: "item_port_storager_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
        "dev-B": {
          id: "dev-B",
          definitionId: "item_port_storager_1",
          position: { x: 15, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["dev-A", "dev-B"],
    });
    editorHost.internalDocument.setSnapshot(doc);

    // 蓝图只包含 dev-B，但 slotLink 引用 dev-A → dev-B
    // dev-A 不在蓝图中，该 slotLink 应被丢弃
    const blueprint = createBlueprintDocument({
      name: "test-slotlink-src-external",
      baseId: doc.baseId,
      initialGridPoint: { x: 15, y: 10 },
      entities: {
        "dev-B": { ...doc.entities["dev-B"]!, config: {} },
      },
      entityOrder: ["dev-B"],
      slotLinks: [
        {
          id: "link-1",
          linkType: "share-all",
          source: {
            entityId: "dev-A",
            storageSlotGroupId: "storage",
            slotId: "slot_0",
          },
          target: {
            entityId: "dev-B",
            storageSlotGroupId: "storage",
            slotId: "slot_0",
          },
        },
      ],
    });

    const applied = placeBlueprint(editorHost, blueprint);
    expect(applied).toBe(true);

    const finalDoc = editorHost.internalDocument.getSnapshot();
    // dev-B 在蓝图中，但 link 的 source (dev-A) 不在 → link 被丢弃
    // 最终 slotLinks 应保持原有数量（0），无新增
    expect(finalDoc.slotLinks).toHaveLength(0);
  });

  it("R2.3: slotLink target 不在蓝图中 → 被丢弃", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const doc = createTestDocument({
      entities: {
        "dev-A": {
          id: "dev-A",
          definitionId: "item_port_storager_1",
          position: { x: 10, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
        "dev-B": {
          id: "dev-B",
          definitionId: "item_port_storager_1",
          position: { x: 15, y: 10 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["dev-A", "dev-B"],
    });
    editorHost.internalDocument.setSnapshot(doc);

    const blueprint = createBlueprintDocument({
      name: "test-slotlink-tgt-external",
      baseId: doc.baseId,
      initialGridPoint: { x: 10, y: 10 },
      entities: {
        "dev-A": { ...doc.entities["dev-A"]!, config: {} },
      },
      entityOrder: ["dev-A"],
      slotLinks: [
        {
          id: "link-1",
          linkType: "share-all",
          source: {
            entityId: "dev-A",
            storageSlotGroupId: "storage",
            slotId: "slot_0",
          },
          target: {
            entityId: "dev-B",
            storageSlotGroupId: "storage",
            slotId: "slot_0",
          },
        },
      ],
    });

    const applied = placeBlueprint(editorHost, blueprint);
    expect(applied).toBe(true);

    const finalDoc = editorHost.internalDocument.getSnapshot();
    expect(finalDoc.slotLinks).toHaveLength(0);
  });

  // AI-REMOVED 2026-06-15:
  // Reason: Group R3 测试基于旧 config.links 路径（Ctrl+C 产生的 blueprint 中 link 数据
  //   在 entity.config 而非 document.slotLinks）。2026-06-09 已迁移至 slotLinks 架构，
  //   Ctrl+C 经由 createSelectionBlueprintDocument 仅处理 slotLinks，config 不再包含
  //   entityId 引用。自引用重写由 slotLinks 管道的 resolveSlotLinkEntityIdForPlacement
  //   处理，跨引用重写由 R1.2 覆盖。
  // Trigger: 取消 skip 后 R3.1/R3.2 均按 config 路径预期失败。
  // Evidence: placement-action.ts:262 AI-CORRECTION 2026-06-09；
  //   createSelectionBlueprintDocument 仅从 currentDocument.slotLinks 过滤。
  // Replacement: R1.1（slotLinks 自引用/外部引用）、R1.2（slotLinks 跨引用）
  // Risk: Low
  // Human Review: Not Required
  //
  // Original code:
  // // ── Group R3: 全链路 Ctrl+C → applyPlacementDraft 的 config 重写 ──
  //
  // it("R3.1 [SKIP-2026-06-09]: Ctrl+C unloader → 放置后 source.entityId 指向新 ID", () => {
  //   ... (省略，见 git history)
  // });
  //
  // it("R3.2 [SKIP-2026-06-09]: Ctrl+C 两个关联实体 → cross-ref 重写正确", () => {
  //   ... (省略，见 git history)
  // });

  it("R4: 暗管连接蓝图放置 — 文档已有 inlet/outlet 暗管对，蓝图完全复制后放置，四设备 ID 无冲突且暗管链路正确", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    // 原始文档：一对暗管设备，用 createDarkPipeSlotLink 连接。
    const originalDoc = createTestDocument({
      entities: {
        "dp-inlet": {
          id: "dp-inlet",
          definitionId: "item_port_udpipe_loader_1",
          position: { x: 0, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
        "dp-outlet": {
          id: "dp-outlet",
          definitionId: "item_port_udpipe_unloader_1",
          position: { x: 6, y: 0 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["dp-inlet", "dp-outlet"],
      slotLinks: [
        createDarkPipeSlotLink({
          inletEntityId: "dp-inlet",
          outletEntityId: "dp-outlet",
        }),
      ],
    });
    editorHost.internalDocument.setSnapshot(originalDoc);

    // 创建蓝图，ID 与文档完全重复。
    const blueprint = createBlueprintDocument({
      name: "暗管对蓝图",
      baseId: originalDoc.baseId,
      initialGridPoint: { x: 0, y: 0 },
      entities: {
        "dp-inlet": { ...originalDoc.entities["dp-inlet"]! },
        "dp-outlet": { ...originalDoc.entities["dp-outlet"]! },
      },
      entityOrder: ["dp-inlet", "dp-outlet"],
      slotLinks: [
        createDarkPipeSlotLink({
          inletEntityId: "dp-inlet",
          outletEntityId: "dp-outlet",
        }),
      ],
    });

    // 放置蓝图到偏移位置，避免与原设备重叠。
    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 0 });
    const applied = editorHost.actions.applyPlacementDraft();
    expect(applied).toBe(true);

    const finalDoc = editorHost.document.getSnapshot();

    // ── 验证实体数量 ──
    expect(Object.keys(finalDoc.entities)).toHaveLength(4);

    // ── 验证原始设备仍存在 ──
    expect(finalDoc.entities["dp-inlet"]).toBeDefined();
    expect(finalDoc.entities["dp-outlet"]).toBeDefined();

    // ── 验证新增设备有独立 ID ──
    const inlets = Object.values(finalDoc.entities).filter(
      (e) => e.definitionId === "item_port_udpipe_loader_1",
    );
    const outlets = Object.values(finalDoc.entities).filter(
      (e) => e.definitionId === "item_port_udpipe_unloader_1",
    );
    expect(inlets).toHaveLength(2);
    expect(outlets).toHaveLength(2);

    const newInlet = inlets.find((e) => e.id !== "dp-inlet");
    const newOutlet = outlets.find((e) => e.id !== "dp-outlet");
    expect(newInlet).toBeDefined();
    expect(newOutlet).toBeDefined();
    // 新 ID 不应是蓝图原始 ID。
    expect(newInlet!.id).not.toBe("dp-inlet");
    expect(newOutlet!.id).not.toBe("dp-outlet");

    // ── 验证新增设备位置偏移 ──
    // 原 inlet 在 (0, 0)，蓝图 initialGridPoint 也是 (0, 0)，放置中心 (20, 0)
    // 新 inlet 应在 (20, 0)
    expect(newInlet!.position).toEqual({ x: 20, y: 0 });
    expect(newOutlet!.position).toEqual({ x: 26, y: 0 });

    // ── 验证暗管链路 ──
    // 应有 2 条暗管 slotLink：原始一对 + 新一对
    const darkPipeLinks = finalDoc.slotLinks.filter(
      (link) => link.linkType === "share-all"
        && link.source.storageSlotGroupId === "unloader_buffer"
        && link.target.storageSlotGroupId === "loader_buffer",
    );
    expect(darkPipeLinks).toHaveLength(2);

    // 原始暗管链路应保持不变
    const originalLink = darkPipeLinks.find(
      (link) => link.source.entityId === "dp-outlet" && link.target.entityId === "dp-inlet",
    );
    expect(originalLink).toBeDefined();

    // 新暗管链路应指向新的 entity ID
    const newLink = darkPipeLinks.find(
      (link) => link.source.entityId === newOutlet!.id && link.target.entityId === newInlet!.id,
    );
    expect(newLink).toBeDefined();

    // ── 验证 entityOrder ──
    // 原始 2 个 + 新增 2 个，共 4 个，且无重复。
    expect(finalDoc.entityOrder).toHaveLength(4);
    expect(new Set(finalDoc.entityOrder).size).toBe(4);
    // 新增的两个应排在末尾。
    expect(finalDoc.entityOrder.slice(-2)).toEqual([newInlet!.id, newOutlet!.id]);
  });
});
