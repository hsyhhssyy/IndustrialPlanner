import { describe, expect, it } from "vitest";

// @ts-expect-error 此脚本是直接由 Node 执行的 mjs，没有单独维护声明文件。
import { buildDeviceAnalysisInput, buildRawDeviceVariants, compareDeviceRecords, extractCurrentRecipeAssignments, generateDeviceI18n } from "../../scripts/compare-exported-devices.mjs";

function createExportFixture() {
  return {
    buildings: {
      buildingItemTable: {
        item_normal: { buildingId: "normal_machine", itemId: "item_normal" },
        item_transmuter: { buildingId: "transmuter", itemId: "item_transmuter" },
      },
      buildingTable: {
        normal_machine: {
          _name: "普通设备",
          _nameEn: "Normal Machine",
          defaultRendererTemplate: "normal__0",
          rendererTemplateMap: {
            normal__0: { machineModeType: "normal" },
          },
        },
        transmuter: {
          _name: "转化机",
          _nameEn: "Transmuter",
          defaultRendererTemplate: "liquidtrans__0",
          rendererTemplateMap: {
            liquidtrans__0: { machineModeType: "liquidtrans" },
            liquidtrans__1: { machineModeType: "liquidtrans" },
            gastrans__0: { machineModeType: "gastrans" },
          },
        },
      },
      machineCrafterTable: {
        normal_machine: {
          modeMap: [
            { groupName: "group_normal_machine_normal", isEnvMode: false, modeName: "normal" },
          ],
        },
        transmuter: {
          modeMap: [
            { groupName: "group_transmuter_liquidtrans", isEnvMode: false, modeName: "liquidtrans" },
            { groupName: "group_transmuter_gastrans", isEnvMode: false, modeName: "gastrans" },
          ],
        },
      },
    },
    recipes: {},
    i18n: { buildings: {} },
  };
}

describe("compare-exported-devices", () => {
  it("collapses renderer groups into semantic variants from machineCrafter modeMap", () => {
    const result = buildRawDeviceVariants(createExportFixture());

    expect(result.rawVariants.map((variant: { originalDeviceId: string; mode: string }) => [
      variant.originalDeviceId,
      variant.mode,
    ])).toEqual([
      ["normal_machine", "normal"],
      ["transmuter", "gastrans"],
      ["transmuter", "liquidtrans"],
    ]);
    expect(result.rawVariants.find((variant: { mode: string }) =>
      variant.mode === "liquidtrans"
    )?.rendererTemplateIds).toEqual(["liquidtrans__0", "liquidtrans__1"]);
  });

  it("treats the only semantic mode as default even when renderer declares another mode", () => {
    const baseFixture = createExportFixture();
    const fixture = {
      ...baseFixture,
      buildings: {
        ...baseFixture.buildings,
        buildingItemTable: {
          ...baseFixture.buildings.buildingItemTable,
          item_vaporizer: { buildingId: "vaporizer", itemId: "item_vaporizer" },
        },
        buildingTable: {
          ...baseFixture.buildings.buildingTable,
          vaporizer: {
            _name: "气体散布机",
            _nameEn: "Gas Dispersing Unit",
            defaultRendererTemplate: "liquid__0",
            rendererTemplateMap: {
              liquid__0: { machineModeType: "liquid" },
            },
          },
        },
        machineCrafterTable: {
          ...baseFixture.buildings.machineCrafterTable,
          vaporizer: {
            modeMap: [
              { groupName: "", isEnvMode: false, modeName: "gas" },
            ],
          },
        },
      },
    };
    const rawData = buildRawDeviceVariants(fixture);
    const vaporizerVariants = rawData.variantsByBuildingId.get("vaporizer");

    expect(vaporizerVariants?.map((variant: { mode: string }) => variant.mode)).toEqual(["gas"]);

    const comparison = compareDeviceRecords({
      rawData,
      currentEntities: [{ id: "vaporizer", nameKey: "vaporizer", tags: [] }],
      zhCN: new Map([["vaporizer", "气体散布机"]]),
      enUS: new Map([["vaporizer", "Gas Dispersing Unit"]]),
    });

    expect(comparison.matchedVariantCount).toBe(1);
    expect(comparison.missingProjectVariants).toEqual([]);
  });

  it("maps every raw mode whose formulas belong to the same project entity", () => {
    const baseFixture = createExportFixture();
    const fixture = {
      ...baseFixture,
      buildings: {
        ...baseFixture.buildings,
        buildingItemTable: {
          ...baseFixture.buildings.buildingItemTable,
          item_shared: { buildingId: "shared_machine", itemId: "item_shared" },
        },
        buildingTable: {
          ...baseFixture.buildings.buildingTable,
          shared_machine: {
            _name: "共用设备",
            _nameEn: "Shared Machine",
            defaultRendererTemplate: "liquid__0",
            rendererTemplateMap: {
              liquid__0: { machineModeType: "liquid" },
              gasliquid__0: { machineModeType: "gasliquid" },
            },
          },
        },
        machineCrafterTable: {
          ...baseFixture.buildings.machineCrafterTable,
          shared_machine: {
            modeMap: [
              { groupName: "group_shared_liquid", isEnvMode: false, modeName: "liquid" },
              { groupName: "group_shared_gasliquid", isEnvMode: false, modeName: "gasliquid" },
            ],
          },
        },
      },
      recipes: {
        formula_liquid: {
          id: "formula_liquid",
          formulaGroupId: "group_shared_liquid",
          machineId: "shared_machine",
        },
        formula_gasliquid: {
          id: "formula_gasliquid",
          formulaGroupId: "group_shared_gasliquid",
          machineId: "shared_machine",
        },
      },
    };
    const rawData = buildRawDeviceVariants(fixture);
    const comparison = compareDeviceRecords({
      rawData,
      currentEntities: [{ id: "shared_machine", nameKey: "shared", tags: [] }],
      currentRecipeMachineIdById: new Map([
        ["formula_liquid", "shared_machine"],
        ["formula_gasliquid", "shared_machine"],
      ]),
      zhCN: new Map([["shared", "共用设备"]]),
      enUS: new Map([["shared", "Shared Machine"]]),
    });

    expect(comparison.matchedVariantCount).toBe(2);
    expect(comparison.missingProjectVariants).toEqual([]);
    expect(comparison.duplicateProjectVariants).toEqual([]);
  });

  it("extracts current project formula assignments from the recipe registry", () => {
    const assignments = extractCurrentRecipeAssignments(`
      export const RECIPE_DEFINITIONS: RecipeDefinition[] = [
        { id: "formula_a", machineId: "machine_a" },
        { id: "formula_b", machineId: "machine_b" },
      ];
    `);

    expect([...assignments]).toEqual([
      ["formula_a", "machine_a"],
      ["formula_b", "machine_b"],
    ]);
  });

  it("derives device names from lossless raw table i18n IDs", () => {
    const tables = {
      FactoryBuildingTable: {
        normal_machine: {
          name: { id: "6693873765078043271" },
          defaultRendererTemplate: "normal__0",
          rendererTemplateMap: {
            normal__0: { machineModeType: "normal" },
          },
        },
      },
      FactoryBuildingItemTable: {
        item_normal: { buildingId: "normal_machine", itemId: "item_normal" },
      },
      I18nTextTable_CN: { "6693873765078043271": "普通设备" },
      I18nTextTable_EN: { "6693873765078043271": "Normal Machine" },
      FactoryMachineCrafterTable: {
        normal_machine: {
          modeMap: [
            { groupName: "group_normal_machine_normal", isEnvMode: false, modeName: "normal" },
          ],
        },
      },
      FactoryMachineCraftTable: {},
    };
    const input = buildDeviceAnalysisInput({
      kind: "local",
      readTable(tableName: keyof typeof tables) {
        return tables[tableName];
      },
    });

    expect(buildRawDeviceVariants(input).rawVariants).toContainEqual(expect.objectContaining({
      originalDeviceId: "normal_machine",
      mode: "normal",
      zhCN: "普通设备",
      enUS: "Normal Machine",
    }));
  });

  it("keeps building-level raw names without synthesizing mode suffixes", () => {
    expect(generateDeviceI18n({ zhCN: "设备", enUS: "Machine" }, "normal")).toEqual({
      zhCN: "设备",
      enUS: "Machine",
    });
    expect(generateDeviceI18n({ zhCN: "设备", enUS: "Machine" }, "gastrans")).toEqual({
      zhCN: "设备",
      enUS: "Machine",
    });
    expect(generateDeviceI18n({ zhCN: "设备", enUS: "Machine" }, "liquid")).toEqual({
      zhCN: "设备",
      enUS: "Machine",
    });
  });

  it("reports i18n changes separately after matching explicit project variants", () => {
    const rawData = buildRawDeviceVariants(createExportFixture());
    const comparison = compareDeviceRecords({
      rawData,
      currentEntities: [
        { id: "normal_machine", nameKey: "normal", tags: [] },
        {
          id: "transmuter_gastrans",
          nameKey: "gas",
          tags: ["alter:transmuter", "alter-variant:gastrans"],
        },
        {
          id: "transmuter_liquidtrans",
          nameKey: "liquid",
          tags: ["alter:transmuter", "alter-variant:liquidtrans"],
        },
      ],
      zhCN: new Map([
        ["normal", "普通设备"],
        ["gas", "转化机"],
        ["liquid", "转化机"],
      ]),
      enUS: new Map([
        ["normal", "Normal Machine"],
        ["gas", "Transmuter (Gas)"],
        ["liquid", "Transmuter"],
      ]),
    });

    expect(comparison.nameModifications.map((device: { id: string }) => device.id)).toEqual([
      "transmuter_gastrans",
    ]);
    expect(comparison.missingProjectVariants).toEqual([]);
  });

  it("keeps only the exact user-reviewed five-character Chinese name exceptions", () => {
    const rawVariants = [
      {
        variantKey: JSON.stringify(["log_hongs_bus", "normal"]),
        originalDeviceId: "log_hongs_bus",
        mode: "normal",
        zhCN: "仓库存取线基段",
        enUS: "Depot Bus Section",
        formulaGroupIds: [],
        rendererTemplateIds: ["normal__0"],
        isEnvironmentMode: false,
        isDefaultRendererMode: true,
      },
      {
        variantKey: JSON.stringify(["log_hongs_bus_source", "normal"]),
        originalDeviceId: "log_hongs_bus_source",
        mode: "normal",
        zhCN: "仓库存取线源桩",
        enUS: "Depot Bus Port",
        formulaGroupIds: [],
        rendererTemplateIds: ["normal__0"],
        isEnvironmentMode: false,
        isDefaultRendererMode: true,
      },
    ];
    const rawData = {
      rawVariants,
      buildingIdByItemId: new Map(),
      variantsByBuildingId: new Map(rawVariants.map((variant) => [
        variant.originalDeviceId,
        [variant],
      ])),
    };
    const currentEntities = [
      { id: "log_hongs_bus", nameKey: "bus", tags: [] },
      { id: "log_hongs_bus_source", nameKey: "source", tags: [] },
    ];
    const zhCN = new Map([
      ["bus", "存取线基段"],
      ["source", "存取线源桩"],
    ]);
    const matchingEnglish = new Map([
      ["bus", "Depot Bus Section"],
      ["source", "Depot Bus Port"],
    ]);

    const comparison = compareDeviceRecords({
      rawData,
      currentEntities,
      zhCN,
      enUS: matchingEnglish,
    });

    expect(comparison.nameModifications).toEqual([]);
    expect(comparison.approvedNameExceptions.map((row: { id: string }) => row.id)).toEqual([
      "log_hongs_bus",
      "log_hongs_bus_source",
    ]);
    expect(comparison.approvedNameExceptions[0].reason).toContain("用户已明确");

    const changedEnglish = compareDeviceRecords({
      rawData,
      currentEntities,
      zhCN,
      enUS: new Map([
        ["bus", "Outdated English Name"],
        ["source", "Depot Bus Port"],
      ]),
    });

    expect(changedEnglish.nameModifications.map((row: { id: string }) => row.id)).toEqual([
      "log_hongs_bus",
    ]);
  });

  it("maps project recipe variants even when rendererTemplateMap has only normal mode", () => {
    const baseFixture = createExportFixture();
    const fixture = {
      ...baseFixture,
      buildings: {
        ...baseFixture.buildings,
        buildingItemTable: {
          ...baseFixture.buildings.buildingItemTable,
          item_furnance: { buildingId: "furnance_1", itemId: "item_furnance" },
        },
        buildingTable: {
          ...baseFixture.buildings.buildingTable,
          furnance_1: {
            _name: "精炼炉",
            _nameEn: "Refining Unit",
            defaultRendererTemplate: "normal__0",
            rendererTemplateMap: {
              normal__0: { machineModeType: "normal" },
            },
          },
        },
        machineCrafterTable: {
          ...baseFixture.buildings.machineCrafterTable,
          furnance_1: {
            modeMap: [
              { groupName: "group_furnance_normal", isEnvMode: false, modeName: "normal" },
              { groupName: "group_furnance_liquid", isEnvMode: false, modeName: "liquid" },
            ],
          },
        },
      },
    };
    const rawData = buildRawDeviceVariants(fixture);
    const comparison = compareDeviceRecords({
      rawData,
      currentEntities: [
        {
          id: "furnance_1",
          nameKey: "furnance",
          tags: ["alter:furnance_1", "alter-variant:normal"],
        },
        {
          id: "liquid_furnance_1",
          nameKey: "liquidFurnance",
          tags: ["alter:furnance_1", "alter-variant:liquid"],
        },
      ],
      zhCN: new Map([
        ["furnance", "精炼炉"],
        ["liquidFurnance", "精炼炉"],
      ]),
      enUS: new Map([
        ["furnance", "Refining Unit"],
        ["liquidFurnance", "Refining Unit"],
      ]),
    });

    expect(comparison.matchedVariantCount).toBe(2);
    expect(comparison.missingProjectVariants).toEqual([]);
    expect(comparison.unsupportedProjectVariants).toEqual([]);
  });

  it("reports a tagged project variant that has no raw mode evidence", () => {
    const rawData = buildRawDeviceVariants(createExportFixture());
    const comparison = compareDeviceRecords({
      rawData,
      currentEntities: [{
        id: "item_normal_liquid",
        nameKey: "liquid",
        tags: ["alter:item_normal", "alter-variant:liquid"],
      }],
      zhCN: new Map([["liquid", "普通设备(液体)"]]),
      enUS: new Map([["liquid", "Normal Machine (Liquid)"]]),
    });

    expect(comparison.unsupportedProjectVariants).toContainEqual(expect.objectContaining({
      id: "item_normal_liquid",
      mode: "liquid",
    }));
  });

  it("reports raw modes that have no project variant mapping", () => {
    const rawData = buildRawDeviceVariants(createExportFixture());
    const comparison = compareDeviceRecords({
      rawData,
      currentEntities: [{
        id: "transmuter_gastrans",
        nameKey: "gas",
        tags: ["alter:transmuter", "alter-variant:gastrans"],
      }],
      zhCN: new Map([["gas", "转化机"]]),
      enUS: new Map([["gas", "Transmuter"]]),
    });

    expect(comparison.missingProjectVariants).toContainEqual(expect.objectContaining({
      originalDeviceId: "transmuter",
      mode: "liquidtrans",
      formulaGroupIds: ["group_transmuter_liquidtrans"],
    }));
  });
});
