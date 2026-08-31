import { describe, expect, it } from "vitest";

// @ts-expect-error 此脚本是直接由 Node 执行的 mjs，没有单独维护声明文件。
import { buildDeviceAnalysisInput, buildExpectedDevices, compareDeviceRecords, generateDeviceI18n } from "../../scripts/compare-exported-devices.mjs";

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
    },
    i18n: { buildings: {} },
  };
}

describe("compare-exported-devices", () => {
  it("uses raw zero-based template indices only when a mode has multiple groups", () => {
    const result = buildExpectedDevices(createExportFixture());

    expect(result.devices.map((device: { id: string }) => device.id)).toEqual([
      "normal_machine",
      "transmuter_gastrans",
      "transmuter_liquidtrans_0",
      "transmuter_liquidtrans_1",
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
    };
    const input = buildDeviceAnalysisInput({
      kind: "local",
      readTable(tableName: keyof typeof tables) {
        return tables[tableName];
      },
    });

    expect(buildExpectedDevices(input).devices).toContainEqual(expect.objectContaining({
      id: "normal_machine",
      zhCN: "普通设备",
      enUS: "Normal Machine",
    }));
  });

  it("generates localized names from mode", () => {
    expect(generateDeviceI18n({ zhCN: "设备", enUS: "Machine" }, "normal")).toEqual({
      zhCN: "设备",
      enUS: "Machine",
    });
    expect(generateDeviceI18n({ zhCN: "设备", enUS: "Machine" }, "gastrans")).toEqual({
      zhCN: "设备(气体)",
      enUS: "Machine (Gas)",
    });
    expect(generateDeviceI18n({ zhCN: "设备", enUS: "Machine" }, "liquid")).toEqual({
      zhCN: "设备(液体)",
      enUS: "Machine (Liquid)",
    });
  });

  it("treats an i18n-only difference as a remove/add record change", () => {
    const expectedData = buildExpectedDevices(createExportFixture());
    const comparison = compareDeviceRecords({
      expectedData,
      currentEntities: [
        { id: "normal_machine", nameKey: "normal", tags: [] },
        { id: "transmuter_gastrans", nameKey: "gas", tags: [] },
      ],
      zhCN: new Map([
        ["normal", "普通设备"],
        ["gas", "转化机（气体）"],
      ]),
      enUS: new Map([
        ["normal", "Normal Machine"],
        ["gas", "Transmuter (Gas)"],
      ]),
    });

    expect(comparison.removals.map((device: { id: string }) => device.id)).toEqual([
      "transmuter_gastrans",
    ]);
    expect(comparison.additions.map((device: { id: string }) => device.id)).toEqual([
      "transmuter_gastrans",
      "transmuter_liquidtrans_0",
      "transmuter_liquidtrans_1",
    ]);
  });

  it("reports an old tagged mode whose template no longer exists", () => {
    const expectedData = buildExpectedDevices(createExportFixture());
    const comparison = compareDeviceRecords({
      expectedData,
      currentEntities: [{
        id: "item_normal_liquid",
        nameKey: "liquid",
        tags: ["alter:item_normal", "alter-variant:liquid"],
      }],
      zhCN: new Map([["liquid", "普通设备(液体)"]]),
      enUS: new Map([["liquid", "Normal Machine (Liquid)"]]),
    });

    expect(comparison.removals).toContainEqual(expect.objectContaining({
      id: "item_normal_liquid",
      mode: "liquid",
      templateId: "（解包来源中不存在）",
    }));
  });
});
