import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

const hosts = new Set<EditorHost>();
beforeEach(() => { localStorage.clear(); vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(async () => {
  try {
    for (const host of hosts) {
      try { await host.internalDocuments.flush(); } finally { host.dispose(); }
    }
  } finally { hosts.clear(); localStorage.clear(); vi.unstubAllGlobals(); }
});

function createHost(): EditorHost {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null, blueprintPlanner: null,
  };
  const host = createEditorHost(workspace);
  hosts.add(host);
  return host;
}

function coreIds(host: EditorHost): string[] {
  return Object.values(host.document.getSnapshot().entities)
    .filter((entity) => host.workspace.registry.queries.isProtocolCore(entity.definitionId)).map((entity) => entity.id);
}

describe("草稿箱协议核心", () => {
  it("首次创建初始化一个核心，删除后切换和启动重载都不补回，删除支持撤销与重做", async () => {
    const host = createHost();
    await host.internalDocuments.ready();
    await host.actions.loadLatestBaseDocument("draft_box");
    expect(coreIds(host)).toEqual(["protocol-core:draft_box"]);
    const initial = host.document.getSnapshot();
    host.internalDocument.setSnapshot({ ...initial, slotLinks: [{ id: "core-link", linkType: "share-all",
      source: { entityId: "protocol-core:draft_box", storageSlotGroupId: "unbuffer_w2", slotId: "slot" },
      target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item_copper_ore" } }] });
    host.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "protocol-core:draft_box" });
    host.actions.deleteCollection(EntityCollectionType.selection);
    expect(coreIds(host)).toEqual([]);
    expect(host.document.getSnapshot().slotLinks).toEqual([]);
    expect(host.actions.undoDocumentHistory()).toBe(true);
    expect(coreIds(host)).toEqual(["protocol-core:draft_box"]);
    expect(host.document.getSnapshot().slotLinks).toHaveLength(1);
    expect(host.actions.redoDocumentHistory()).toBe(true);
    expect(coreIds(host)).toEqual([]);
    await host.internalDocuments.flush();
    await host.actions.loadLatestBaseDocument("wuling_protocol_core");
    await host.actions.loadLatestBaseDocument("draft_box");
    expect(coreIds(host)).toEqual([]);
    await host.internalDocuments.flush();
    host.dispose(); hosts.delete(host);
    const restored = createHost();
    await restored.internalDocuments.ready();
    expect(restored.document.getSnapshot().baseId).toBe("draft_box");
    expect(coreIds(restored)).toEqual([]);
  });

  it("手动放置与重复蓝图放置累加核心，保存后保留实体、配置和连接", async () => {
    const host = createHost();
    await host.internalDocuments.ready();
    await host.actions.loadLatestBaseDocument("draft_box");
    const initialId = coreIds(host)[0]!;
    host.actions.createSinglePlacementDraft("sp_hub_1", { x: 35, y: 35 });
    expect(host.actions.applyPlacementDraft()).toBe(true);
    expect(coreIds(host)).toHaveLength(2);
    const cores = {
      primary: { id: "primary", definitionId: "sp_hub_1", position: { x: 0, y: 0 }, rotation: 0 as const,
        config: { retained: "primary" }, tags: [] },
      secondary: { id: "secondary", definitionId: "sp_sub_hub_1", position: { x: 12, y: 0 }, rotation: 180 as const,
        config: { retained: "secondary" }, tags: [] },
    };
    const blueprint = createBlueprintDocument({ name: "两种核心", baseId: "valley4_protocol_core",
      initialGridPoint: { x: 0, y: 0 }, entities: cores, entityOrder: Object.keys(cores),
      slotLinks: [{ id: "local-link", linkType: "share-all",
        source: { entityId: "primary", storageSlotGroupId: "unbuffer_w2", slotId: "slot" },
        target: { entityId: "secondary", storageSlotGroupId: "inbuffer_n2", slotId: "slot" } }],
    });
    for (const x of [70, 110]) {
      host.actions.createBlueprintPlacementDraft?.(blueprint, { x, y: 70 });
      expect(host.actions.applyPlacementDraft()).toBe(true);
    }
    expect(coreIds(host)).toHaveLength(6);
    expect(host.document.getSnapshot().entities[initialId]).toBeDefined();
    const expected = host.document.getSnapshot();
    expect(expected.slotLinks).toHaveLength(2);
    expect(Object.values(expected.entities).filter((entity) => entity.definitionId === "sp_sub_hub_1")).toHaveLength(2);
    expect(host.actions.undoDocumentHistory()).toBe(true);
    expect(coreIds(host)).toHaveLength(4);
    expect(host.actions.redoDocumentHistory()).toBe(true);
    expect(coreIds(host)).toHaveLength(6);
    await host.internalDocuments.flush();
    host.dispose(); hosts.delete(host);
    const restored = createHost();
    await restored.internalDocuments.ready();
    const document = restored.document.getSnapshot();
    expect(document.entities).toEqual(expected.entities);
    expect(document.entityOrder).toEqual(expected.entityOrder);
    expect(document.slotLinks).toEqual(expected.slotLinks);
  });

  it("普通基地继续禁止删除核心，含核心蓝图继续替换现有核心", async () => {
    const host = createHost();
    await host.internalDocuments.ready();
    const originalId = coreIds(host)[0]!;
    host.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: originalId });
    host.actions.deleteCollection(EntityCollectionType.selection);
    expect(coreIds(host)).toEqual([originalId]);
    const source = host.document.getSnapshot().entities[originalId]!;
    host.actions.createBlueprintPlacementDraft?.(createBlueprintDocument({ name: "普通基地核心",
      baseId: host.document.getSnapshot().baseId, initialGridPoint: { x: 0, y: 0 },
      entities: { [source.id]: source }, entityOrder: [source.id], slotLinks: [],
    }), { x: 25, y: 25 });
    expect(host.actions.applyPlacementDraft()).toBe(true);
    expect(coreIds(host)).toHaveLength(1);
    expect(coreIds(host)).not.toContain(originalId);
  });
});
