import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createEditorHost } from "@/editor/editor-host";
import { createSimulationHost } from "@/simulation/simulation-host";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import fixtureJson from "../fixtures/blueprints/editor-regional-dark-pipe/scene.schema7.json";

beforeEach(() => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  localStorage.setItem("v3-experimental-regional-multi-base", "true");
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

// 与原 E2E 共用版本化场景；连接、历史、后台文档维护和存储均使用真实主机。
async function setup() {
  const { app, workspace } = createAppTestWorkspace();
  const editor = createEditorHost(workspace);
  const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  const inlet = "wuling_protocol_core", outlet = "wuling_tianwangping_aid";
  const settle = async () => {
    await editor.internalDocuments.settleMaintenance();
    await editor.internalHistory.flush();
    await editor.internalDocuments.flush();
  };
  const dispose = async () => {
    try { await settle(); }
    finally { simulation.dispose(); editor.dispose(); app.dispose(); }
  };
  try {
    await editor.internalDocuments.ready();
    await app.regionalSettings.hydrate();
    app.regionalSettings.setMultiBaseEnabled(true);
    expect(app.state.settings.regionalMultiBaseEnabled).toBe(true);
    const fixture = normalizeBlueprintDocument(fixtureJson)!;
    for (const before of await editor.queries.readLatestBaseDocuments([inlet, outlet])) {
      await editor.actions.applySynchronizedDocument({ ...before,
        entities: { ...before.entities, ...fixture.entities },
        entityOrder: [...before.entityOrder, ...fixture.entityOrder], slotLinks: fixture.slotLinks });
    }
    expect(await editor.actions.loadLatestBaseDocument(inlet)).toBe(true);
    return { app, editor, inlet, outlet, settle, dispose,
      connect: () => editor.actions.createDarkPipeLink({ sourceBaseId: inlet, sourceEntityId: "inlet",
        targetBaseId: outlet, targetEntityId: "outlet" }),
      documents: () => editor.queries.readLatestBaseDocuments([inlet, outlet]),
    };
  } catch (error) { await dispose(); throw error; }
}

it("跨基地关系仅属于出口，清理参与端点而保留其他仓库链接；入口断开后从出口撤销", async () => {
  const env = await setup();
  try {
    expect(await env.connect()).toBe(true);
    const [inlet, outlet] = await env.documents();
    expect(inlet!.slotLinks.map(link => link.id)).toEqual(["warehouse-outlet", "warehouse-other-outlet"]);
    expect(inlet!.entities.inlet!.config).toEqual({});
    expect(outlet!.slotLinks).toHaveLength(2);
    expect(outlet!.slotLinks.find(link => link.target.baseId !== undefined)?.target)
      .toMatchObject({ baseId: env.inlet, entityId: "inlet" });
    expect(outlet!.slotLinks).toContainEqual(expect.objectContaining({ id: "warehouse-other-outlet" }));
    expect(outlet!.entities.outlet!.config).toEqual({});
    expect(await env.connect()).toBe(false);
    expect(await env.editor.actions.removeDarkPipeLink("inlet")).toBe(true);
    expect(env.editor.queries.getRegionalDarkPipeLinks()).toHaveLength(0);
    expect(await env.editor.actions.loadLatestBaseDocument(env.outlet)).toBe(true);
    expect(env.editor.actions.undoDocumentHistory()).toBe(true);
    await env.settle();
    expect((await env.documents())[1]!.slotLinks).toEqual(outlet!.slotLinks);
    expect(env.editor.queries.getRegionalDarkPipeLinks()).toHaveLength(1);
  } finally { await env.dispose(); }
});

it("关闭多基地仅隐藏关系，显式本地连接覆盖远端占用，重新开启不会复活", async () => {
  const env = await setup();
  try {
    expect(await env.connect()).toBe(true);
    const connected = (await env.documents())[1]!.slotLinks;
    env.app.regionalSettings.setMultiBaseEnabled(false);
    expect(env.editor.queries.getRegionalDarkPipeLinks()).toHaveLength(0);
    expect((await env.documents())[1]!.slotLinks).toEqual(connected);
    expect(await env.editor.actions.createDarkPipeLink({ sourceEntityId: "inlet", targetEntityId: "outlet" })).toBe(true);
    const [inlet, outlet] = await env.documents();
    expect(inlet!.slotLinks.map(link => link.id)).toEqual(["warehouse-other-outlet", "dark-pipe-link:outlet:inlet"]);
    expect(outlet!.slotLinks.map(link => link.id)).toEqual(["warehouse-other-outlet"]);
    env.app.regionalSettings.setMultiBaseEnabled(true);
    expect(env.editor.queries.getRegionalDarkPipeLinks()).toHaveLength(0);
    expect(await env.editor.actions.removeDarkPipeLink("outlet")).toBe(true);
    expect((await env.documents())[0]!.slotLinks.map(link => link.id)).toEqual(["warehouse-other-outlet"]);
  } finally { await env.dispose(); }
});

it.each(["inventory", "warehouse", "delete"] as const)("%s 编辑清理旧跨基地关系，不影响旁侧出口", async operation => {
  const env = await setup();
  try {
    expect(await env.connect()).toBe(true);
    if (operation === "warehouse") {
      expect(await env.editor.actions.loadLatestBaseDocument(env.outlet)).toBe(true);
      env.app.regionalSettings.setMultiBaseEnabled(false);
      expect(env.editor.actions.createWarehouseSlotLink({ entityId: "outlet",
        storageSlotGroupId: "unloader_buffer", slotId: "slot_1", itemId: "item_liquid_water" })).toBe(true);
    } else if (operation === "inventory") {
      env.app.regionalSettings.setMultiBaseEnabled(false);
      env.editor.actions.patchEntityConfig("inlet", {
        "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
        "storageSlotGroups[0].slots[0].initialCount": 4,
        "storageSlotGroups[0].slots[0].ignoreStock": false,
      });
    } else {
      env.editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: "inlet" });
      env.editor.actions.deleteCollection(EntityCollectionType.selection);
      expect(env.editor.document.getSnapshot().entities.inlet).toBeUndefined();
    }
    await env.settle();
    const links = (await env.documents())[1]!.slotLinks;
    expect(links.every(link => link.target.entityId === "warehouse")).toBe(true);
    expect(links).toHaveLength(operation === "warehouse" ? 2 : 1);
    expect(links).toContainEqual(expect.objectContaining({ id: "warehouse-other-outlet" }));
    env.app.regionalSettings.setMultiBaseEnabled(true);
    expect(env.editor.queries.getRegionalDarkPipeLinks()).toHaveLength(0);
  } finally { await env.dispose(); }
});
