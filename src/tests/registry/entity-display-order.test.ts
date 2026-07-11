import { describe, expect, it } from "vitest";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { buildEncyclopediaIndex } from "@/app/shell/encyclopedia/encyclopedia-browser";
import { resolveDeviceIdForPlacementGroupShortcut } from "@/app/input/gesture/actions/hypergryph/hypergryph-single-placement-gesture-module";
import type { EntityDefinition, UiGroup } from "@/domain/registry/types/entity-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";


// =========================================================================
// displayOrder 回归测试
//
// 验证：
//   1. registry 中已知设备的 displayOrder 值正确
//   2. 同 uiGroup 内 displayOrder 无冲突
//   3. buildEncyclopediaIndex 按 displayOrder 排序 allEntities
//   4. resolveDeviceIdForPlacementGroupShortcut 按 displayOrder 解析快捷键
// =========================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function definitionById(
  id: string,
): EntityDefinition | undefined {
  return ENTITY_DEFINITIONS.find((definition) => definition.id === id);
}

// ---------------------------------------------------------------------------
// 1. Registry displayOrder 值验证
// ---------------------------------------------------------------------------

describe("ENTITY_DEFINITIONS displayOrder", () => {
  const EXPECTED_ORDERS: Record<string, number> = {
    // 100 — beltLogistics
    item_log_connector: 101,
    item_log_splitter: 102,
    item_log_converger: 103,
    item_log_admission: 104,

    // 200 — pipeLogistics
    item_pipe_connector: 201,
    item_pipe_splitter: 202,
    item_pipe_converger: 203,
    item_pipe_admission: 204,

    // 300 — resourcePower
    item_port_water_pump_1: 301,
    item_port_power_diffuser_1: 302,
    item_port_power_sta_1: 303,
    item_port_gas_diffuser_1: 304,

    // 400 — warehouse
    item_port_storager_1: 401,
    item_port_loader_1: 402,
    item_port_unloader_1: 403,
    item_port_liquid_storager_1: 404,
    item_port_log_hongs_bus: 405,
    item_port_log_hongs_bus_source: 406,
    item_port_udpipe_loader_1: 407,
    item_port_udpipe_unloader_1: 408,
    item_port_udpipe_loader_2: 409,
    item_port_udpipe_unloader_2: 410,
    item_port_gas_storager_1: 411,

    // 500 — basicProduction
    item_port_furnance_1: 501,
    item_port_liquid_furnance_1: 502,
    item_port_grinder_1: 503,
    item_port_cmpt_mc_1: 504,
    item_port_shaper_1: 505,
    item_port_seedcol_1: 506,
    item_port_planter_1: 507,
    item_port_hydro_planter_1: 508,
    item_liquid_cleaner_1: 509,
    item_water_purifier_node_1: 510,

    // 600 — advancedManufacturing
    item_port_winder_1: 601,
    item_port_filling_pd_mc_1: 602,
    item_port_liquid_filling_pd_mc_1: 603,
    item_port_tools_asm_mc_1: 604,
    item_port_thickener_1: 605,
    item_port_mix_pool_1: 606,
    item_port_mix_pool_large_1: 607,
    item_port_xiranite_oven_1: 608,
    item_port_liquid_purifier_1: 609,
    item_port_dismantler_1: 610,
    item_port_solid_gas_converter_1: 611,
    item_port_gas_reactor_1: 612,
    item_port_liquid_gas_converter_1: 613,
  };

  for (const [id, expectedOrder] of Object.entries(EXPECTED_ORDERS)) {
    it(`${id} has displayOrder ${expectedOrder}`, () => {
      const definition = definitionById(id);
      expect(definition, `EntityDefinition for ${id} must exist`).toBeDefined();
      expect(definition!.displayOrder).toBe(expectedOrder);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. 同 uiGroup 内 displayOrder 唯一性
// ---------------------------------------------------------------------------

describe("displayOrder uniqueness within uiGroup", () => {
  const NON_HIDDEN_GROUPS: UiGroup[] = [
    "beltLogistics",
    "pipeLogistics",
    "resourcePower",
    "warehouse",
    "basicProduction",
    "advancedManufacturing",
  ];

  for (const group of NON_HIDDEN_GROUPS) {
    it(`${group} has no duplicate displayOrder`, () => {
      const groupEntities = ENTITY_DEFINITIONS.filter(
        (definition) =>
          definition.uiGroup === group
          && !definition.tags.includes("不可摆放"),
      );
      const orders = groupEntities.map((e) => e.displayOrder);
      const uniqueOrders = new Set(orders);
      expect(uniqueOrders.size).toBe(orders.length);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. 同 uiGroup 内按 displayOrder 升序排列
// ---------------------------------------------------------------------------

describe("displayOrder ascending within uiGroup", () => {
  it("beltLogistics entities are ordered 101→104", () => {
    const ids = sortedIdsByGroup("beltLogistics");
    expect(ids).toEqual([
      "item_log_connector",
      "item_log_splitter",
      "item_log_converger",
      "item_log_admission",
    ]);
  });

  it("pipeLogistics entities are ordered 201→204", () => {
    const ids = sortedIdsByGroup("pipeLogistics");
    expect(ids).toEqual([
      "item_pipe_connector",
      "item_pipe_splitter",
      "item_pipe_converger",
      "item_pipe_admission",
    ]);
  });

  it("resourcePower visible entities begin with water_pump→power_diffuser→power_sta", () => {
    const ids = sortedIdsByGroup("resourcePower");
    const waterIdx = ids.indexOf("item_port_water_pump_1");
    const diffuserIdx = ids.indexOf("item_port_power_diffuser_1");
    const staIdx = ids.indexOf("item_port_power_sta_1");
    expect(waterIdx).toBeLessThan(diffuserIdx);
    expect(diffuserIdx).toBeLessThan(staIdx);
  });

  it("warehouse visible entities begin with storager→loader→unloader→liquid_storager", () => {
    const ids = sortedIdsByGroup("warehouse");
    const storagerIdx = ids.indexOf("item_port_storager_1");
    const loaderIdx = ids.indexOf("item_port_loader_1");
    const unloaderIdx = ids.indexOf("item_port_unloader_1");
    const liquidIdx = ids.indexOf("item_port_liquid_storager_1");
    expect(storagerIdx).toBeLessThan(loaderIdx);
    expect(loaderIdx).toBeLessThan(unloaderIdx);
    expect(unloaderIdx).toBeLessThan(liquidIdx);
  });

  it("basicProduction entities begin with furnance→liquid_furnance→grinder→cmpt", () => {
    const ids = sortedIdsByGroup("basicProduction");
    const furnanceIdx = ids.indexOf("item_port_furnance_1");
    const liquidIdx = ids.indexOf("item_port_liquid_furnance_1");
    const grinderIdx = ids.indexOf("item_port_grinder_1");
    const cmptIdx = ids.indexOf("item_port_cmpt_mc_1");
    expect(furnanceIdx).toBeLessThan(liquidIdx);
    expect(liquidIdx).toBeLessThan(grinderIdx);
    expect(grinderIdx).toBeLessThan(cmptIdx);
  });

  it("advancedManufacturing entities begin with winder→tools_asm→thickener", () => {
    const ids = sortedIdsByGroup("advancedManufacturing");
    const winderIdx = ids.indexOf("item_port_winder_1");
    const toolsIdx = ids.indexOf("item_port_tools_asm_mc_1");
    const thickenerIdx = ids.indexOf("item_port_thickener_1");
    expect(winderIdx).toBeLessThan(toolsIdx);
    expect(toolsIdx).toBeLessThan(thickenerIdx);
  });
});

// ---------------------------------------------------------------------------
// 4. buildEncyclopediaIndex allEntities 排序
// ---------------------------------------------------------------------------

describe("buildEncyclopediaIndex allEntities ordering", () => {
  it("produces allEntities sorted by displayOrder", () => {
    const index = buildEncyclopediaIndex([], [], []);
    const orders = index.allEntities.map((e) => e.displayOrder);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i - 1]!).toBeLessThanOrEqual(orders[i]!);
    }
  });

  it("excludes hidden uiGroup entities", () => {
    const hiddenEntity = createEntityStub("hidden-device", "hidden", 999);
    const visibleEntity = createEntityStub("visible-device", "basicProduction", 100);
    const index = buildEncyclopediaIndex(
      [],
      [hiddenEntity, visibleEntity],
      [],
    );
    expect(index.allEntities.map((e) => e.id)).toEqual(["visible-device"]);
  });

  it("uses displayOrder as primary key and id as tiebreaker", () => {
    const a = createEntityStub("a-device", "basicProduction", 200);
    const b = createEntityStub("b-device", "basicProduction", 200);
    const c = createEntityStub("c-device", "basicProduction", 100);
    const index = buildEncyclopediaIndex([], [a, b, c], []);
    expect(index.allEntities.map((e) => e.id)).toEqual(["c-device", "a-device", "b-device"]);
  });
});

// ---------------------------------------------------------------------------
// 5. resolveDeviceIdForPlacementGroupShortcut 排序
// ---------------------------------------------------------------------------

describe("resolveDeviceIdForPlacementGroupShortcut", () => {
  function createRegistryStub(
    definitions: EntityDefinition[],
  ): RegistryContract {
    return {
      entityDefinitions: definitions,
    } as unknown as RegistryContract;
  }

  it("resolves shortcut 0 to the entity with lowest displayOrder", () => {
    const registry = createRegistryStub([
      createEntityStub("z-device", "basicProduction", 600),
      createEntityStub("a-device", "basicProduction", 500),
      createEntityStub("m-device", "basicProduction", 550),
    ]);
    expect(
      resolveDeviceIdForPlacementGroupShortcut({
        registry,
        group: "basicProduction",
        shortcutIndex: 0,
      }),
    ).toBe("a-device");
  });

  it("uses id as tiebreaker when displayOrder matches", () => {
    const registry = createRegistryStub([
      createEntityStub("c-device", "basicProduction", 100),
      createEntityStub("a-device", "basicProduction", 100),
      createEntityStub("b-device", "basicProduction", 100),
    ]);
    expect(
      resolveDeviceIdForPlacementGroupShortcut({
        registry,
        group: "basicProduction",
        shortcutIndex: 0,
      }),
    ).toBe("a-device");
  });

  it("skips entities tagged 不可摆放", () => {
    const registry = createRegistryStub([
      createEntityStub("z-device", "basicProduction", 100, ["不可摆放"]),
      createEntityStub("a-device", "basicProduction", 200),
    ]);
    expect(
      resolveDeviceIdForPlacementGroupShortcut({
        registry,
        group: "basicProduction",
        shortcutIndex: 0,
      }),
    ).toBe("a-device");
  });

  it("returns null when shortcutIndex exceeds available entities", () => {
    const registry = createRegistryStub([
      createEntityStub("a-device", "basicProduction", 100),
    ]);
    expect(
      resolveDeviceIdForPlacementGroupShortcut({
        registry,
        group: "basicProduction",
        shortcutIndex: 1,
      }),
    ).toBeNull();
  });

  it("respects canUseDefinition filter", () => {
    const registry = createRegistryStub([
      createEntityStub("z-device", "basicProduction", 100),
      createEntityStub("a-device", "basicProduction", 200),
    ]);
    const result = resolveDeviceIdForPlacementGroupShortcut({
      registry,
      group: "basicProduction",
      shortcutIndex: 0,
      canUseDefinition: (definition) => definition.id !== "z-device",
    });
    expect(result).toBe("a-device");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedIdsByGroup(group: UiGroup): string[] {
  return ENTITY_DEFINITIONS
    .filter(
      (definition) =>
        definition.uiGroup === group
        && !definition.tags.includes("不可摆放"),
    )
    .sort(
      (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
    )
    .map((definition) => definition.id);
}

function createEntityStub(
  id: string,
  uiGroup: UiGroup,
  displayOrder: number,
  tags: string[] = [],
): EntityDefinition {
  return {
    id,
    nameKey: `${id}.name`,
    spriteId: id,
    footprint: { width: 1, height: 1 },
    uiGroup,
    displayOrder,
    tags,
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
  };
}
