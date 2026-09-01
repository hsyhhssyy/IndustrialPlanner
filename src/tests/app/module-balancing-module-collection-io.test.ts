import { describe, expect, it } from "vitest";

import type {
  ModuleBalancingCustomModule,
  ModuleBalancingFolder,
  ModuleBalancingIOPort,
} from "@/app/toolbox-types";
import type {
  ModuleBalancingCustomModuleReadWrite,
  ModuleBalancingFolderReadWrite,
} from "@/app/state/state-impl";
import {
  applyModuleCollectionImport,
  buildModuleCollectionExportData,
  buildModuleCollectionImportPlan,
  parseModuleCollectionImportData,
  type ModuleCollectionExportData,
} from "@/app/shell/module-balancing/canvas-io";

function makePort(itemId: string, perMinute: number): ModuleBalancingIOPort {
  return { itemId, perMinute };
}

function makeCustomModule(
  overrides: Partial<ModuleBalancingCustomModule> = {},
): ModuleBalancingCustomModule {
  return {
    schemaVersion: 2,
    id: "module-a",
    name: "模块 A",
    color: "#4f8cff",
    iconItemIds: ["gear"],
    notes: "",
    folderId: null,
    inputs: [makePort("iron", 30)],
    outputs: [makePort("plate", 15)],
    sourceType: "custom",
    ...overrides,
  };
}

function makeCollection(options: {
  readonly folders?: readonly ModuleBalancingFolder[];
  readonly modules?: readonly ModuleBalancingCustomModule[];
} = {}): ModuleCollectionExportData {
  return buildModuleCollectionExportData({
    name: "测试集合",
    folders: options.folders ?? [],
    modules: options.modules ?? [makeCustomModule()],
  });
}

describe("module collection export format", () => {
  it("uses the same collection shape for a single module", () => {
    const data = buildModuleCollectionExportData({
      name: "模块 A",
      folders: [],
      modules: [makeCustomModule({ folderId: "source-folder" })],
    });

    expect(data).toMatchObject({
      kind: "module-collection",
      version: 2,
      name: "模块 A",
      folders: [],
    });
    expect(data.modules).toHaveLength(1);
    expect(data.modules[0]?.folderId).toBeNull();
  });

  it("preserves included folder relationships for folder and root exports", () => {
    const folder = { id: "source-folder", name: "冶炼" };
    const data = buildModuleCollectionExportData({
      name: folder.name,
      folders: [folder],
      modules: [
        makeCustomModule({ id: "folder-module", folderId: folder.id }),
        makeCustomModule({ id: "root-module", folderId: null }),
      ],
    });

    expect(data.folders).toEqual([folder]);
    expect(data.modules.map((module) => module.folderId)).toEqual([folder.id, null]);
  });
});

describe("parseModuleCollectionImportData", () => {
  it("parses a valid collection and restores known folder references", () => {
    const raw = makeCollection({
      folders: [{ id: "folder-a", name: "文件夹 A" }],
      modules: [makeCustomModule({ folderId: "folder-a" })],
    });

    const data = parseModuleCollectionImportData(raw);

    expect(data?.folders).toEqual([{ id: "folder-a", name: "文件夹 A" }]);
    expect(data?.modules[0]?.folderId).toBe("folder-a");
  });

  it("migrates a legacy single icon and returns the current collection version", () => {
    const module = makeCustomModule();
    const rawModule = {
      ...module,
      schemaVersion: undefined,
      iconItemIds: undefined,
      iconId: "item_port_grinder_1",
    };
    const data = parseModuleCollectionImportData({
      ...makeCollection({ modules: [] }),
      version: 1,
      modules: [rawModule],
    });

    expect(data?.version).toBe(2);
    expect(data?.modules[0]?.iconItemIds).toEqual(["plate"]);
  });

  it("moves orphan folder references to the imported root", () => {
    const raw = {
      ...makeCollection(),
      modules: [makeCustomModule({ folderId: "missing-folder" })],
    };

    expect(parseModuleCollectionImportData(raw)?.modules[0]?.folderId).toBeNull();
  });

  it("rejects incompatible versions and duplicate identities", () => {
    expect(parseModuleCollectionImportData({
      ...makeCollection(),
      version: 3,
    })).toBeNull();
    expect(parseModuleCollectionImportData({
      ...makeCollection(),
      modules: [makeCustomModule(), makeCustomModule()],
    })).toBeNull();
    expect(parseModuleCollectionImportData({
      ...makeCollection(),
      folders: [
        { id: "folder-a", name: "文件夹 A" },
        { id: "folder-a", name: "文件夹 B" },
      ],
    })).toBeNull();
  });
});

describe("module collection import plan", () => {
  it("uses canvas import rules for create, reuse, and conflict actions", () => {
    const localModules = [
      makeCustomModule({ id: "reuse", name: "本地复用" }),
      makeCustomModule({ id: "conflict", name: "本地冲突" }),
    ];
    const data = makeCollection({
      modules: [
        makeCustomModule({ id: "create", name: "新增" }),
        makeCustomModule({ id: "reuse", name: "导入复用" }),
        makeCustomModule({
          id: "conflict",
          name: "导入冲突",
          inputs: [makePort("copper", 60)],
        }),
      ],
    });

    const plan = buildModuleCollectionImportPlan(data, localModules);

    expect(plan.moduleActions.map((action) => action.kind)).toEqual([
      "create",
      "reuse",
      "conflict",
    ]);
    expect(plan.moduleIdMapping.get("create")).toBe("create");
    expect(plan.moduleIdMapping.get("reuse")).toBe("reuse");
    expect(plan.moduleIdMapping.has("conflict")).toBe(false);
  });
});

describe("applyModuleCollectionImport", () => {
  it("creates new folders, keeps reused modules, and preserves local folders on overwrite", () => {
    const localFolder: ModuleBalancingFolderReadWrite = {
      id: "local-folder",
      name: "本地文件夹",
    };
    const localModules: ModuleBalancingCustomModuleReadWrite[] = [
      makeCustomModule({
        id: "reuse",
        name: "本地复用",
        folderId: localFolder.id,
      }) as ModuleBalancingCustomModuleReadWrite,
      makeCustomModule({
        id: "conflict",
        name: "本地冲突",
        folderId: localFolder.id,
      }) as ModuleBalancingCustomModuleReadWrite,
    ];
    const folders: ModuleBalancingFolderReadWrite[] = [localFolder];
    const data = makeCollection({
      folders: [{ id: "import-folder", name: "导入文件夹" }],
      modules: [
        makeCustomModule({ id: "create", name: "新增", folderId: "import-folder" }),
        makeCustomModule({ id: "reuse", name: "导入复用", folderId: "import-folder" }),
        makeCustomModule({
          id: "conflict",
          name: "导入冲突",
          folderId: "import-folder",
          outputs: [makePort("gear", 20)],
        }),
      ],
    });
    const plan = buildModuleCollectionImportPlan(data, localModules);

    applyModuleCollectionImport(plan, localModules, folders);

    const importedFolder = folders.find((folder) => folder.name === "导入文件夹");
    expect(importedFolder?.id).not.toBe("import-folder");
    expect(localModules.find((module) => module.id === "create")?.folderId).toBe(importedFolder?.id);
    expect(localModules.find((module) => module.id === "reuse")).toMatchObject({
      name: "本地复用",
      folderId: localFolder.id,
    });
    expect(localModules.find((module) => module.id === "conflict")).toMatchObject({
      name: "导入冲突",
      folderId: localFolder.id,
      outputs: [{ itemId: "gear", perMinute: 20 }],
    });
  });
});
