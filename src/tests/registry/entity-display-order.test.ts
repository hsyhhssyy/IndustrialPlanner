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
    log_connector: 101,
    log_splitter: 102,
    log_converger: 103,
    log_admission: 104,

    // 200 — pipeLogistics
    pipe_connector: 201,
    pipe_splitter: 202,
    pipe_converger: 203,
    pipe_admission: 204,

    // 300 — resourcePower
    water_pump_1: 301,
    power_diffuser_1: 302,
    power_sta_1: 303,
    vaporizer_1: 304,
    water_purifier_node_1: 305,

    // 400 — warehouse
    storager_1: 401,
    loader_1: 402,
    unloader_1: 403,
    liquid_storager_1: 404,
    log_hongs_bus: 405,
    log_hongs_bus_source: 406,
    udpipe_loader_1: 407,
    udpipe_unloader_1: 408,
    udpipe_loader_2: 409,
    udpipe_unloader_2: 410,
    gas_storager_1: 411,

    // 500 — basicProduction
    furnance_1: 501,
    liquid_furnance_1: 502,
    grinder_1: 503,
    cmpt_mc_1: 504,
    shaper_1: 505,
    shaper_1_gas: 506,
    seedcol_1: 507,
    planter_1: 508,
    hydro_planter_1: 509,
    liquid_cleaner_1: 510,

    // 600 — advancedManufacturing
    winder_1: 601,
    filling_pd_mc_1: 602,
    liquid_filling_pd_mc_1: 603,
    tools_asm_mc_1: 604,
    thickener_1: 605,
    mix_pool_1: 606,
    mix_pool_2: 607,
    xiranite_oven_1: 608,
    liquid_purifier_1: 609,
    liquid_purifier_1_gas: 610,
    dismantler_1: 611,
    transmuter_2_gastrans: 612,
    transmuter_2_solidtrans: 613,
    gas_reactor_1: 614,
    transmuter_1_gastrans: 615,
    transmuter_1_liquidtrans: 616,

    // 700 — cheat
    cheat_infinite_solid: 701,
    cheat_infinite_liquid: 702,
    cheat_infinite_gas: 703,
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
    "cheat",
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
      "log_connector",
      "log_splitter",
      "log_converger",
      "log_admission",
    ]);
  });

  it("pipeLogistics entities are ordered 201→204", () => {
    const ids = sortedIdsByGroup("pipeLogistics");
    expect(ids).toEqual([
      "pipe_connector",
      "pipe_splitter",
      "pipe_converger",
      "pipe_admission",
    ]);
  });

  it("resourcePower visible entities begin with water_pump→power_diffuser→power_sta", () => {
    const ids = sortedIdsByGroup("resourcePower");
    const waterIdx = ids.indexOf("water_pump_1");
    const diffuserIdx = ids.indexOf("power_diffuser_1");
    const staIdx = ids.indexOf("power_sta_1");
    expect(waterIdx).toBeLessThan(diffuserIdx);
    expect(diffuserIdx).toBeLessThan(staIdx);
  });

  it("warehouse visible entities begin with storager→loader→unloader→liquid_storager", () => {
    const ids = sortedIdsByGroup("warehouse");
    const storagerIdx = ids.indexOf("storager_1");
    const loaderIdx = ids.indexOf("loader_1");
    const unloaderIdx = ids.indexOf("unloader_1");
    const liquidIdx = ids.indexOf("liquid_storager_1");
    expect(storagerIdx).toBeLessThan(loaderIdx);
    expect(loaderIdx).toBeLessThan(unloaderIdx);
    expect(unloaderIdx).toBeLessThan(liquidIdx);
  });

  it("basicProduction entities begin with furnance→liquid_furnance→grinder→cmpt", () => {
    const ids = sortedIdsByGroup("basicProduction");
    const furnanceIdx = ids.indexOf("furnance_1");
    const liquidIdx = ids.indexOf("liquid_furnance_1");
    const grinderIdx = ids.indexOf("grinder_1");
    const cmptIdx = ids.indexOf("cmpt_mc_1");
    expect(furnanceIdx).toBeLessThan(liquidIdx);
    expect(liquidIdx).toBeLessThan(grinderIdx);
    expect(grinderIdx).toBeLessThan(cmptIdx);
  });

  it("advancedManufacturing entities begin with winder→tools_asm→thickener", () => {
    const ids = sortedIdsByGroup("advancedManufacturing");
    const winderIdx = ids.indexOf("winder_1");
    const toolsIdx = ids.indexOf("tools_asm_mc_1");
    const thickenerIdx = ids.indexOf("thickener_1");
    expect(winderIdx).toBeLessThan(toolsIdx);
    expect(toolsIdx).toBeLessThan(thickenerIdx);
  });

  it("cheat entities are ordered solid→liquid→gas", () => {
    expect(sortedIdsByGroup("cheat")).toEqual([
      "cheat_infinite_solid",
      "cheat_infinite_liquid",
      "cheat_infinite_gas",
    ]);
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

  it("excludes cheat entities from every encyclopedia entity index", () => {
    const cheatEntity = createEntityStub("cheat-device", "cheat", 701);
    const visibleEntity = createEntityStub("visible-device", "basicProduction", 100);
    const index = buildEncyclopediaIndex([], [cheatEntity, visibleEntity], []);

    expect(index.allEntities.map((entity) => entity.id)).toEqual(["visible-device"]);
    expect(index.entityById.has("cheat-device")).toBe(false);
    expect(index.entityPinyin.has("cheat-device")).toBe(false);
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

  it("uses the persisted family variant when device modes are collapsed", () => {
    const registry = createRegistryStub([
      createEntityStub("device-normal", "basicProduction", 100, [
        "alter:device-family",
        "alter-variant:normal",
        "MainCraftGroup",
      ]),
      createEntityStub("device-liquid", "basicProduction", 101, [
        "alter:device-family",
        "alter-variant:liquid",
      ]),
      createEntityStub("standalone", "basicProduction", 200),
    ]);

    expect(resolveDeviceIdForPlacementGroupShortcut({
      registry,
      group: "basicProduction",
      shortcutIndex: 0,
      collapseDeviceModes: true,
      selectedVariantNameByCraftGroup: {
        "device-family": "liquid",
      },
    })).toBe("device-liquid");
    expect(resolveDeviceIdForPlacementGroupShortcut({
      registry,
      group: "basicProduction",
      shortcutIndex: 0,
      collapseDeviceModes: true,
      selectedVariantNameByCraftGroup: {},
    })).toBe("device-normal");
    expect(resolveDeviceIdForPlacementGroupShortcut({
      registry,
      group: "basicProduction",
      shortcutIndex: 1,
      collapseDeviceModes: true,
      selectedVariantNameByCraftGroup: {},
    })).toBe("standalone");
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
