import { describe, expect, it } from "vitest";

import type {
  ModuleBalancingCanvas,
  ModuleBalancingCustomModule,
  ModuleBalancingIOPort,
} from "@/app/toolbox-types";
import {
  buildCanvasExportData,
  buildCanvasImportPlan,
  parseCanvasImportData,
  type CanvasExportData,
} from "@/app/shell/module-balancing/canvas-io";
import { createModuleBalancingId } from "@/app/shell/module-balancing/module-balancing-model";

// ── 测试数据工厂 ──

function makePort(itemId: string, perMinute: number, infinite?: boolean): ModuleBalancingIOPort {
  return { itemId, perMinute, ...(infinite === true ? { infinite: true } : {}) };
}

function makeCustomModule(overrides: Partial<ModuleBalancingCustomModule> = {}): ModuleBalancingCustomModule {
  return {
    schemaVersion: 2,
    id: createModuleBalancingId(),
    name: "Test Module",
    color: "#4f8cff",
    iconItemIds: ["gear"],
    notes: "",
    inputs: [makePort("iron", 30)],
    outputs: [makePort("plate", 15)],
    sourceType: "custom",
    ...overrides,
  };
}

function makeCanvas(overrides: Partial<ModuleBalancingCanvas> = {}): ModuleBalancingCanvas {
  return {
    id: createModuleBalancingId(),
    name: "Test Canvas",
    globalInputs: [makePort("iron", 60)],
    stages: [
      {
        id: createModuleBalancingId(),
        name: "Stage 1",
        entries: [{ moduleId: "smelt_plate", quantity: 2 }],
      },
    ],
    warehouseCapacity: 100,
    ...overrides,
  };
}

function makeExport(overrides: Partial<CanvasExportData> = {}): CanvasExportData {
  return {
    version: 2,
    canvas: {
      name: "Test",
      folderId: null,
      globalInputs: [],
      stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "m1", quantity: 1 }] }],
      warehouseCapacity: null,
    },
    modules: [],
    ...overrides,
  };
}

// ── 导出测试 ──

describe("buildCanvasExportData", () => {
  it("includes canvas settings", () => {
    const canvas = makeCanvas({ name: "My Canvas", warehouseCapacity: 200 });
    const customModules: ModuleBalancingCustomModule[] = [];

    const result = buildCanvasExportData(canvas, customModules);

    expect(result.version).toBe(2);
    expect(result.canvas.name).toBe("My Canvas");
    expect(result.canvas.warehouseCapacity).toBe(200);
    expect(result.canvas.globalInputs).toHaveLength(1);
    expect(result.canvas.globalInputs[0]!.itemId).toBe("iron");
    expect(result.canvas.stages).toHaveLength(1);
  });

  it("only exports custom modules used by the canvas", () => {
    const usedModule = makeCustomModule({ id: "custom-a" });
    const unusedModule = makeCustomModule({ id: "custom-b" });
    const canvas = makeCanvas({
      stages: [
        {
          id: createModuleBalancingId(),
          name: "Stage 1",
          entries: [{ moduleId: "custom-a", quantity: 1 }],
        },
      ],
    });

    const result = buildCanvasExportData(canvas, [usedModule, unusedModule]);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]!.id).toBe("custom-a");
  });

  it("excludes system-recipe modules from export", () => {
    const canvas = makeCanvas({
      stages: [
        {
          id: createModuleBalancingId(),
          name: "Stage 1",
          entries: [{ moduleId: "smelt_plate", quantity: 1 }],
        },
      ],
    });

    const result = buildCanvasExportData(canvas, []);

    expect(result.modules).toHaveLength(0);
  });

  it("excludes recommended modules from export", () => {
    const recommendedId = "recommended:starter";
    const canvas = makeCanvas({
      stages: [
        {
          id: createModuleBalancingId(),
          name: "Stage 1",
          entries: [{ moduleId: recommendedId, quantity: 1 }],
        },
      ],
    });

    const result = buildCanvasExportData(canvas, []);

    expect(result.modules).toHaveLength(0);
  });

  it("exports module with all fields", () => {
    const module = makeCustomModule({
      id: "custom-full",
      name: "Full Module",
      color: "#ff0000",
      iconItemIds: ["ore", "plate", "iron", "copper"],
      notes: "Some notes",
      inputs: [makePort("iron", 30), makePort("copper", 15)],
      outputs: [makePort("plate", 20)],
    });
    const canvas = makeCanvas({
      stages: [
        {
          id: createModuleBalancingId(),
          name: "Stage 1",
          entries: [{ moduleId: "custom-full", quantity: 1 }],
        },
      ],
    });

    const result = buildCanvasExportData(canvas, [module]);

    const exportedModule = result.modules[0]!;
    expect(exportedModule.id).toBe("custom-full");
    expect(exportedModule.name).toBe("Full Module");
    expect(exportedModule.color).toBe("#ff0000");
    expect(exportedModule.iconItemIds).toEqual(["ore", "plate", "iron", "copper"]);
    expect(exportedModule.notes).toBe("Some notes");
    expect(exportedModule.inputs).toHaveLength(2);
    expect(exportedModule.outputs).toHaveLength(1);
    expect(exportedModule.sourceType).toBe("custom");
    expect(exportedModule).not.toHaveProperty("recipeId");
  });

  it("empty canvas exports empty modules", () => {
    const canvas = makeCanvas({ stages: [] });
    const result = buildCanvasExportData(canvas, []);
    expect(result.modules).toHaveLength(0);
  });

  it("canvas with globalInputs infinite flag is preserved", () => {
    const canvas = makeCanvas({
      globalInputs: [makePort("water", 0, true)],
      stages: [],
    });
    const result = buildCanvasExportData(canvas, []);
    expect(result.canvas.globalInputs[0]!.infinite).toBe(true);
    expect(result.canvas.globalInputs[0]!.perMinute).toBe(0);
  });
});

// ── 导入解析测试 ──

describe("parseCanvasImportData", () => {
  it("parses valid export data", () => {
    const data = makeExport();
    const result = parseCanvasImportData(data);
    expect(result).not.toBeNull();
    expect(result?.canvas.name).toBe("Test");
  });

  it("rejects wrong version", () => {
    const result = parseCanvasImportData({ version: 3, canvas: {}, modules: [] });
    expect(result).toBeNull();
  });

  it("rejects missing canvas", () => {
    const result = parseCanvasImportData({ version: 1, modules: [] });
    expect(result).toBeNull();
  });

  it("rejects empty canvas name", () => {
    const result = parseCanvasImportData(makeExport({ canvas: { ...makeExport().canvas, name: "  " } }));
    expect(result).toBeNull();
  });

  it("rejects stages with no valid entries", () => {
    const data = makeExport({
      canvas: {
        ...makeExport().canvas,
        stages: [
          { id: "s1", name: "S1", entries: [{ moduleId: "", quantity: 0 }] },
        ],
      },
    });
    const result = parseCanvasImportData(data);
    expect(result).toBeNull();
  });

  it("filters out invalid ports", () => {
    const rawData = {
      version: 1,
      canvas: {
        name: "Test",
        folderId: null,
        globalInputs: [
          { itemId: "iron", perMinute: 30 },
          { itemId: "", perMinute: 0 },
          null,
        ] as unknown[],
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "m1", quantity: 1 }] }],
        warehouseCapacity: null,
      },
      modules: [],
    };
    const result = parseCanvasImportData(rawData);
    expect(result?.canvas.globalInputs).toHaveLength(1);
  });

  it("parses custom modules", () => {
    const module = makeCustomModule({ id: "custom-x" });
    const data = makeExport({
      canvas: {
        ...makeExport().canvas,
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "custom-x", quantity: 2 }] }],
      },
      modules: [module],
    });
    const result = parseCanvasImportData(data);
    expect(result?.modules).toHaveLength(1);
    expect(result?.modules[0]!.id).toBe("custom-x");
  });

  it("migrates a legacy single icon when parsing a version 1 canvas", () => {
    const rawModule = {
      ...makeCustomModule({ id: "custom-legacy" }),
      schemaVersion: undefined,
      iconItemIds: undefined,
      iconId: "item_port_grinder_1",
    };
    const result = parseCanvasImportData({
      ...makeExport({
        canvas: {
          ...makeExport().canvas,
          stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "custom-legacy", quantity: 1 }] }],
        },
      }),
      version: 1,
      modules: [rawModule],
    });

    expect(result?.version).toBe(2);
    expect(result?.modules[0]?.iconItemIds).toEqual(["plate"]);
  });

  it("filters out invalid custom modules", () => {
    const rawData = {
      version: 1,
      canvas: {
        name: "Test",
        folderId: null,
        globalInputs: [],
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "m1", quantity: 1 }] }],
        warehouseCapacity: null,
      },
      modules: [{ sourceType: "custom", id: "", name: "", inputs: [], outputs: [] } as unknown],
    };
    const result = parseCanvasImportData(rawData);
    expect(result?.modules).toHaveLength(0);
  });
});

// ── 导入匹配测试 ──

describe("buildCanvasImportPlan", () => {
  it("creates module when GUID does not exist locally", () => {
    const importData = makeExport({
      modules: [makeCustomModule({ id: "guid-a", name: "Module A" })],
      canvas: {
        ...makeExport().canvas,
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "guid-a", quantity: 1 }] }],
      },
    });

    const plan = buildCanvasImportPlan(importData, []);

    expect(plan.moduleActions).toHaveLength(1);
    expect(plan.moduleActions[0]!.kind).toBe("create");
    expect(plan.moduleIdMapping.get("guid-a")).toBe("guid-a");
  });

  it("reuses module when GUID exists and inputs/outputs match", () => {
    const localModule = makeCustomModule({
      id: "guid-a",
      inputs: [makePort("iron", 30)],
      outputs: [makePort("plate", 15)],
    });
    const importData = makeExport({
      modules: [makeCustomModule({
        id: "guid-a",
        name: "Updated Name",
        inputs: [makePort("iron", 30)],
        outputs: [makePort("plate", 15)],
      })],
      canvas: {
        ...makeExport().canvas,
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "guid-a", quantity: 1 }] }],
      },
    });

    const plan = buildCanvasImportPlan(importData, [localModule]);

    expect(plan.moduleActions).toHaveLength(1);
    expect(plan.moduleActions[0]!.kind).toBe("reuse");
    expect(plan.moduleIdMapping.get("guid-a")).toBe("guid-a");
  });

  it("detects conflict when GUID exists but inputs differ", () => {
    const localModule = makeCustomModule({
      id: "guid-a",
      name: "Local A",
      inputs: [makePort("iron", 30)],
      outputs: [makePort("plate", 15)],
    });
    const importData = makeExport({
      modules: [makeCustomModule({
        id: "guid-a",
        name: "Import A",
        inputs: [makePort("copper", 30)],
        outputs: [makePort("plate", 15)],
      })],
      canvas: {
        ...makeExport().canvas,
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "guid-a", quantity: 1 }] }],
      },
    });

    const plan = buildCanvasImportPlan(importData, [localModule]);

    const conflicts = plan.moduleActions.filter((a) => a.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0]! as { kind: "conflict"; importName: string; localName: string }).importName).toBe("Import A");
    expect((conflicts[0]! as { kind: "conflict"; importName: string; localName: string }).localName).toBe("Local A");
  });

  it("detects conflict when GUID exists but outputs differ", () => {
    const localModule = makeCustomModule({
      id: "guid-a",
      inputs: [makePort("iron", 30)],
      outputs: [makePort("plate", 15)],
    });
    const importData = makeExport({
      modules: [makeCustomModule({
        id: "guid-a",
        inputs: [makePort("iron", 30)],
        outputs: [makePort("gear", 15)],
      })],
      canvas: {
        ...makeExport().canvas,
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "guid-a", quantity: 1 }] }],
      },
    });

    const plan = buildCanvasImportPlan(importData, [localModule]);

    const conflicts = plan.moduleActions.filter((a) => a.kind === "conflict");
    expect(conflicts).toHaveLength(1);
  });

  it("detects conflict when perMinute differs", () => {
    const localModule = makeCustomModule({
      id: "guid-a",
      inputs: [makePort("iron", 30)],
      outputs: [makePort("plate", 15)],
    });
    const importData = makeExport({
      modules: [makeCustomModule({
        id: "guid-a",
        inputs: [makePort("iron", 60)],
        outputs: [makePort("plate", 15)],
      })],
      canvas: {
        ...makeExport().canvas,
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "guid-a", quantity: 1 }] }],
      },
    });

    const plan = buildCanvasImportPlan(importData, [localModule]);

    const conflicts = plan.moduleActions.filter((a) => a.kind === "conflict");
    expect(conflicts).toHaveLength(1);
  });

  it("no conflict when inputs/outputs are identical (name difference ignored)", () => {
    const localModule = makeCustomModule({
      id: "guid-a",
      name: "Old Name",
      inputs: [makePort("iron", 30)],
      outputs: [makePort("plate", 15)],
    });
    const importData = makeExport({
      modules: [makeCustomModule({
        id: "guid-a",
        name: "New Name",
        inputs: [makePort("iron", 30)],
        outputs: [makePort("plate", 15)],
      })],
      canvas: {
        ...makeExport().canvas,
        stages: [{ id: "s1", name: "S1", entries: [{ moduleId: "guid-a", quantity: 1 }] }],
      },
    });

    const plan = buildCanvasImportPlan(importData, [localModule]);

    expect(plan.moduleActions[0]!.kind).toBe("reuse");
  });

  it("canvas data is preserved in import plan", () => {
    const importData = makeExport({
      canvas: {
        name: "My Canvas",
        folderId: null,
        globalInputs: [makePort("iron", 60, true)],
        stages: [{ id: "s1", name: "Smelt", entries: [{ moduleId: "guid-a", quantity: 2 }] }],
        warehouseCapacity: 500,
      },
      modules: [makeCustomModule({ id: "guid-a" })],
    });

    const plan = buildCanvasImportPlan(importData, []);

    expect(plan.canvasData.name).toBe("My Canvas");
    expect(plan.canvasData.warehouseCapacity).toBe(500);
    expect(plan.canvasData.globalInputs[0]!.infinite).toBe(true);
    expect(plan.canvasData.stages[0]!.name).toBe("Smelt");
    expect(plan.canvasData.stages[0]!.entries[0]!.moduleId).toBe("guid-a");
    expect(plan.canvasData.stages[0]!.entries[0]!.quantity).toBe(2);
  });
});
