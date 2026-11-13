import type { EditorHost } from "@/editor/editor-host";
import type { AppHost } from "@/app/host/app-host";
import type * as Storage from "@/shared/storage";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { runInAction } from "mobx";

/** 构建插件将函数体注入组合根；普通产品构建不导入本文件。 */
export function installReleaseBridge(
  app: AppHost,
  storage: typeof Storage,
  action: typeof runInAction,
  label: string,
  schema: number,
) {
  const editor = app.workspace.editor as EditorHost;
  const simulation = app.workspace.simulation;
  if (!editor?.internalDocuments || !simulation) throw Error("Release bridge requires initialized hosts");
  async function flush() {
    await editor.internalHistory.flush();
    await editor.internalDocuments.flush();
  }
  window.__releaseTest = {
    label, schema,
    async ready() {
      await flush();
      return Boolean(document.querySelector("canvas"));
    },
    async seed(fixture: BlueprintDocument) {
      await editor.actions.loadLatestBaseDocument(fixture.baseId);
      await flush();
      const current = editor.document.getSnapshot();
      editor.internalDocumentWriter.setSnapshot({
        ...current,
        entities: { ...current.entities, ...fixture.entities },
        entityOrder: [...current.entityOrder, ...fixture.entityOrder],
        slotLinks: fixture.slotLinks,
        regions: fixture.regions,
      });
      editor.actions.patchEntityConfig("source-storage", { "storageSlotGroups[0].slots[0].initialCount": 25 });
      await flush();
      for (const id of ["release-keep", "release-delete"]) {
        if (!await storage.saveBlueprintDocument({ ...fixture, blueprintId: id })) throw Error("Seed blueprint failed");
      }
      storage.saveToLocalStorage("v3-release-sentinel", { stage: "A", text: "原始数据\n☃" });
      action(() => { app.internalState.workbench.toolbox.moduleBalancing.canvases[0]!.name = "Release A"; });
    },
    async edit() {
      editor.actions.patchEntityConfig("source-storage", { "storageSlotGroups[0].slots[0].initialCount": 99 });
      const blueprint = await storage.readBlueprintRecord("release-keep");
      if (!blueprint) throw Error("Missing blueprint");
      if (!await storage.saveBlueprintDocument({ ...blueprint, name: "B edited" })) throw Error("Edit failed");
      if (!await storage.saveBlueprintDocument({ ...blueprint, blueprintId: "release-new" })) throw Error("Create failed");
      await storage.deleteBlueprintDocument("release-delete");
      storage.saveToLocalStorage("v3-release-sentinel", { stage: "B" });
      storage.saveToLocalStorage("v3-release-new", "B new");
      action(() => { app.internalState.workbench.toolbox.moduleBalancing.canvases[0]!.name = "Release B"; });
      await flush();
    },
    async modulePersisted(name: string) {
      const record = await storage.readFromIndexedDb<{ data: { canvases: { name: string }[] } }>({
        databaseName: "v3-industrial-planner", storeName: "module-balancing-state", key: "v1",
      });
      return record?.data.canvases[0]?.name === name;
    },
    async document() {
      await flush();
      return JSON.parse(JSON.stringify(editor.document.getSnapshot())) as ReturnType<typeof editor.document.getSnapshot>;
    },
    async focus() {
      app.mainCanvas.focusOnEntity("source-storage", { duration: 1 });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    async simulate() {
      const blueprint = await storage.readBlueprintRecord("release-keep");
      if (!blueprint) throw Error("Missing simulation blueprint");
      return simulation.actions.runBlueprint({
        blueprint,
        scene: { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" },
        probes: [{ id: "sink", entityIds: ["sink-storage"], itemId: "item_iron_ore", direction: "input" }],
        warmupSeconds: 0, observationSeconds: 5, inventorySampleCount: 2, maxWallTimeMs: 20_000, activeActivityIds: [],
      });
    },
  };
}

declare global {
  interface Window {
    __releaseTest: {
      label: string;
      schema: number;
      ready(): Promise<boolean>;
      seed(fixture: BlueprintDocument): Promise<void>;
      edit(): Promise<void>;
      modulePersisted(name: string): Promise<boolean>;
      document(): Promise<ReturnType<EditorHost["document"]["getSnapshot"]>>;
      focus(): Promise<void>;
      simulate(): ReturnType<NonNullable<AppHost["workspace"]["simulation"]>["actions"]["runBlueprint"]>;
    };
  }
}
