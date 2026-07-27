import { BASE_DEFINITIONS } from "@/registry/base-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import { createRegistryContract } from "@/registry";
import {
  buildBaseBuiltinEntityId,
} from "@/domain/registry/types/base-definition";
import { WATER_PURIFIER_NODE_ENTITY_ID } from "@/shared/water-purifier-node";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { describe, expect, it } from "vitest";

describe("createRegistryContract", () => {
  it("exposes local base definitions without reusing the source array", () => {
    const registry = createRegistryContract();

    expect(registry.baseDefinitions).toEqual(BASE_DEFINITIONS);
    expect(registry.baseDefinitions).not.toBe(BASE_DEFINITIONS);
  });

  it("keeps base definitions structurally valid", () => {
    const seenIds = new Set<string>();

    for (const definition of BASE_DEFINITIONS) {
      expect(definition.id).toBeTruthy();
      expect(seenIds.has(definition.id)).toBe(false);
      seenIds.add(definition.id);

      expect(definition.tag).toBeTruthy();
      expect(definition.placeableArea.width).toBeGreaterThan(0);
      expect(definition.placeableArea.height).toBeGreaterThan(0);
      expect(definition.outerRing.top).toBeGreaterThanOrEqual(0);
      expect(definition.outerRing.right).toBeGreaterThanOrEqual(0);
      expect(definition.outerRing.bottom).toBeGreaterThanOrEqual(0);
      expect(definition.outerRing.left).toBeGreaterThanOrEqual(0);
      expect(definition.outerRing.top % 5).toBe(0);
      expect(definition.outerRing.right % 5).toBe(0);
      expect(definition.outerRing.bottom % 5).toBe(0);
      expect(definition.outerRing.left % 5).toBe(0);
      expect([5, 10]).toContain(definition.outerRing.top);
      expect([5, 10]).toContain(definition.outerRing.right);
      expect([5, 10]).toContain(definition.outerRing.bottom);
      expect([5, 10]).toContain(definition.outerRing.left);

      // AI-REMOVED 2026-05-10:
      // Reason: 用户澄清约束是 outerRing 每个方向的格数分别必须是 5 的整数倍，不是外扩总面积满足 5 整除。
      // Trigger: 之前基于错误前提新增了面积整除校验，会放过方向值不是 5 倍数但总面积凑巧满足条件的错误配置。
      // Evidence: 当前会话中的用户更正；base-definition 的数据模型明确按 top/right/bottom/left 四个方向存储外扩值。
      // Replacement: 使用上面的四个方向逐项取模断言。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const expandedWidth =
      //   definition.placeableArea.width
      //   + definition.outerRing.left
      //   + definition.outerRing.right;
      // const expandedHeight =
      //   definition.placeableArea.height
      //   + definition.outerRing.top
      //   + definition.outerRing.bottom;
      // const expansionArea =
      //   expandedWidth * expandedHeight
      //   - definition.placeableArea.width * definition.placeableArea.height;
      //
      // expect(expansionArea % 5).toBe(0);
    }
  });

  it("classifies dedicated and general logistics devices by definition id", () => {
    const registry = createRegistryContract();

    expect(registry.queries.isDedicatedLogisticsDevice("belt_straight_1x1")).toBe(true);
    expect(registry.queries.isDedicatedLogisticsDevice("pipe_turn_ccw_1x1")).toBe(true);
    expect(registry.queries.isDedicatedLogisticsDevice("log_splitter")).toBe(false);
    expect(registry.queries.isDedicatedLogisticsDevice("pipe_connector")).toBe(false);

    expect(registry.queries.isGeneralLogisticsDevice("belt_straight_1x1")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("log_splitter")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("log_converger")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("log_connector")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("pipe_splitter")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("pipe_converger")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("pipe_connector")).toBe(true);

    expect(registry.queries.isGeneralLogisticsDevice("log_admission")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("pipe_admission")).toBe(true);
    expect(registry.queries.isGeneralLogisticsDevice("ore_miner")).toBe(false);

    expect(registry.queries.resolveDedicatedLogisticsKind("belt_straight_1x1")).toBe("belt");
    expect(registry.queries.resolveDedicatedLogisticsKind("pipe_turn_ccw_1x1")).toBe("pipe");
    expect(registry.queries.resolveDedicatedLogisticsKind("log_splitter")).toBeNull();
  });

  it("按传送带节、传送带物流设备、管道节和管道物流设备精确分类", () => {
    const registry = createRegistryContract();
    const beltSegments = [
      "belt_straight_1x1",
      "belt_turn_cw_1x1",
      "belt_turn_ccw_1x1",
    ];
    const beltLogistics = [
      "log_splitter",
      "log_converger",
      "log_connector",
      "log_admission",
    ];
    const pipeSegments = [
      "pipe_straight_1x1",
      "pipe_turn_cw_1x1",
      "pipe_turn_ccw_1x1",
    ];
    const pipeLogistics = [
      "pipe_splitter",
      "pipe_converger",
      "pipe_connector",
      "pipe_admission",
    ];
    const definitionIds = registry.entityDefinitions.map((definition) => definition.id);
    const classifiedIds = (
      predicate: (definitionId: string) => boolean,
    ): string[] => definitionIds.filter(predicate).sort();

    expect(classifiedIds(registry.queries.isBelt)).toEqual([...beltSegments].sort());
    expect(classifiedIds(registry.queries.isBeltLogistics)).toEqual(
      [...beltLogistics].sort(),
    );
    expect(classifiedIds(registry.queries.isBeltFamily)).toEqual(
      [...beltSegments, ...beltLogistics].sort(),
    );
    expect(classifiedIds(registry.queries.isPipe)).toEqual([...pipeSegments].sort());
    expect(classifiedIds(registry.queries.isPipeLogistics)).toEqual(
      [...pipeLogistics].sort(),
    );
    expect(classifiedIds(registry.queries.isPipeFamily)).toEqual(
      [...pipeSegments, ...pipeLogistics].sort(),
    );

    // 物流设备明确不包括路径节。
    for (const definitionId of beltSegments) {
      expect(registry.queries.isBeltLogistics(definitionId)).toBe(false);
    }
    for (const definitionId of pipeSegments) {
      expect(registry.queries.isPipeLogistics(definitionId)).toBe(false);
    }

    expect(registry.queries.resolveLogisticsDefinitionId(
      LOGISTICS_KIND.belt,
      "straight",
    )).toBe("belt_straight_1x1");
    expect(registry.queries.resolveLogisticsDefinitionId(
      LOGISTICS_KIND.pipe,
      "turn-ccw",
    )).toBe("pipe_turn_ccw_1x1");

    const roles = {
      log_splitter: "splitter",
      log_converger: "converger",
      log_connector: "connector",
      log_admission: "admission",
      pipe_splitter: "splitter",
      pipe_converger: "converger",
      pipe_connector: "connector",
      pipe_admission: "admission",
    } as const;
    for (const [definitionId, role] of Object.entries(roles)) {
      expect(registry.queries.resolveLogisticsRole(definitionId)).toBe(role);
    }
    for (const definitionId of [...beltSegments, ...pipeSegments]) {
      expect(registry.queries.resolveLogisticsRole(definitionId)).toBeNull();
    }

    for (const definitionId of ["udpipe_loader_1", "water_pump_1", "unknown"]) {
      expect(registry.queries.isBeltFamily(definitionId)).toBe(false);
      expect(registry.queries.isPipeFamily(definitionId)).toBe(false);
      expect(registry.queries.resolveLogisticsRole(definitionId)).toBeNull();
    }

    const beltSegmentDefinitions = registry.entityDefinitions.filter((definition) =>
      registry.queries.isBelt(definition.id)
    );
    const pipeSegmentDefinitions = registry.entityDefinitions.filter((definition) =>
      registry.queries.isPipe(definition.id)
    );
    expect(beltSegmentDefinitions.every((definition) => definition.uiGroup === "hidden"))
      .toBe(true);
    expect(pipeSegmentDefinitions.every((definition) => definition.uiGroup === "hidden"))
      .toBe(true);
    expect(
      registry.entityDefinitions
        .filter((definition) => registry.queries.isBeltLogistics(definition.id))
        .every((definition) => definition.uiGroup === "beltLogistics"),
    ).toBe(true);
    expect(
      registry.entityDefinitions
        .filter((definition) => registry.queries.isPipeLogistics(definition.id))
        .every((definition) => definition.uiGroup === "pipeLogistics"),
    ).toBe(true);
    expect(
      registry.entityDefinitions.some((definition) =>
        definition.tags.includes("BeltFamily")
        || definition.tags.includes("PipeFamily")
      ),
    ).toBe(false);
  });

  it("mounts the read-only logistics-item inspector on every logistics device and no others", () => {
    const registry = createRegistryContract();
    const expectedDeviceIds = [
      "belt_straight_1x1",
      "belt_turn_cw_1x1",
      "belt_turn_ccw_1x1",
      "log_splitter",
      "log_converger",
      "log_connector",
      "pipe_straight_1x1",
      "pipe_turn_cw_1x1",
      "pipe_turn_ccw_1x1",
      "pipe_splitter",
      "pipe_converger",
      "pipe_connector",
      "log_admission",
      "pipe_admission",
    ].sort();
    const mountedDeviceIds = registry.entityDefinitions
      .filter((definition) => definition.inspectors.some(
        (inspector) => inspector.type === INSPECTOR_TYPE.logisticsItem,
      ))
      .map((definition) => definition.id)
      .sort();

    expect(mountedDeviceIds).toEqual(expectedDeviceIds);
  });

  it("mounts slot-config inspectors on every recipe machine storage group", () => {
    const registry = createRegistryContract();
    const recipeMachineIds = new Set(
      registry.recipeDefinitions.map((recipe) => recipe.machineId),
    );

    for (const machineId of recipeMachineIds) {
      const definition = registry.entityDefinitions.find(
        (candidate) => candidate.id === machineId,
      );

      expect(definition, `${machineId} must have an entity definition`).toBeDefined();

      if (definition === undefined) {
        continue;
      }

      // 找出所有通过 portStorageBindings 绑定了端口的存储槽组
      const consumptionStorageGroupIds = new Set(
        definition.recipeChannels
          .filter((channel) => channel.type === "consumption-channel")
          .flatMap((channel) => channel.ingredientStorageGroupIds),
      );
      const boundStorageSlotGroupIds = definition.storageSlotGroups
        .filter((storageSlotGroup) =>
          !consumptionStorageGroupIds.has(storageSlotGroup.id)
          &&
          definition.portStorageBindings.some((b) => b.storageSlotGroupId === storageSlotGroup.id),
        )
        .map((g) => g.id);

      if (boundStorageSlotGroupIds.length === 0) {
        continue;
      }

      // 必须有且仅有一个 slotConfig inspector，包含所有绑定的槽组 ID
      const slotConfigInspectors = definition.inspectors.filter(
        (inspector) => inspector.type === INSPECTOR_TYPE.slotConfig,
      );

      expect(
        slotConfigInspectors,
        `${machineId} must have exactly one slotConfig inspector`,
      ).toHaveLength(1);

      const inspector = slotConfigInspectors[0];

      if (inspector === undefined) continue;

      // 验证 slotConfig 声明确实有 slotGroupIds
      expect(
        "slotGroupIds" in inspector,
        `${machineId} slotConfig must use slotGroupIds`,
      ).toBe(true);

      const slotGroupIds = (inspector as { slotGroupIds: readonly string[] }).slotGroupIds;
      if (machineId === WATER_PURIFIER_NODE_ENTITY_ID) {
        expect(slotGroupIds).toEqual(["xiranite_waste_buffer"]);
        continue;
      }
      expect([...slotGroupIds].sort()).toEqual([...boundStorageSlotGroupIds].sort());
    }
  });

  it("assigns bus source + segments to valley4 protocol core and 5 x-segments to the other three bases", () => {
    const VALLEY4_BASE_IDS = [
      "valley4_protocol_core",
      "valley4_refugee_shelter",
      "valley4_infra_outpost",
      "valley4_rebuilt_command",
    ] as const;

    const valley4Definitions = BASE_DEFINITIONS.filter((definition) =>
      VALLEY4_BASE_IDS.includes(definition.id as (typeof VALLEY4_BASE_IDS)[number]),
    );

    expect(valley4Definitions).toHaveLength(4);

    // 其他三个基地有 5 个 X 方向基段，无源桩
    // 订正（2026-07-13）：首个内置基段通过 warehouseBusSeed 声明为隐藏仓库总线锚点。
    const nonCoreDefinitions = valley4Definitions.filter(
      (definition) => definition.id !== "valley4_protocol_core",
    );
    for (const definition of nonCoreDefinitions) {
      expect(definition.builtinEntities).toBeDefined();
      expect(definition.builtinEntities).toHaveLength(5);

      for (let index = 0; index < 5; index += 1) {
        const builtin = definition.builtinEntities![index]!;
        expect(builtin.definitionId).toBe("log_hongs_bus");
        expect(builtin.position).toEqual({ x: index * 8, y: -4 });
        expect(builtin.rotation).toBe(90);
        expect(builtin.config).toEqual(index === 0 ? { warehouseBusSeed: true } : undefined);
      }
    }

    // 协议核心区有源桩 + X 方向 9 个基段 + Y 方向 9 个基段
    const protocolCore = valley4Definitions.find(
      (definition) => definition.id === "valley4_protocol_core",
    )!;
    expect(protocolCore.builtinEntities).toHaveLength(19);

    const source = protocolCore.builtinEntities![0]!;
    expect(source.definitionId).toBe("log_hongs_bus_source");
    expect(source.position).toEqual({ x: -4, y: -4 });

    const xSegments = protocolCore.builtinEntities!.slice(1, 10);
    for (let index = 0; index < xSegments.length; index += 1) {
      const segment = xSegments[index]!;
      expect(segment.definitionId).toBe("log_hongs_bus");
      expect(segment.position).toEqual({ x: index * 8, y: -4 });
      expect(segment.rotation).toBe(90);
    }

    const ySegments = protocolCore.builtinEntities!.slice(10, 19);
    for (let index = 0; index < ySegments.length; index += 1) {
      const segment = ySegments[index]!;
      expect(segment.definitionId).toBe("log_hongs_bus");
      expect(segment.position).toEqual({ x: -4, y: index * 8 });
      expect(segment.rotation).toBe(0);
    }

    const wulingDefinitions = BASE_DEFINITIONS.filter((definition) =>
      definition.tag === "武陵",
    );

    for (const definition of wulingDefinitions) {
      expect(definition.builtinEntities ?? []).toHaveLength(0);
    }

    // 验证 ID 协议：同一 builtin ID 在不同基地下生成不同全局 ID
    const coreId = buildBaseBuiltinEntityId({
      baseId: "valley4_protocol_core",
      builtinEntityId: "valley4_bus_seg_x_0",
    });
    const shelterId = buildBaseBuiltinEntityId({
      baseId: "valley4_refugee_shelter",
      builtinEntityId: "valley4_bus_seg_x_0",
    });

    expect(coreId).not.toBe(shelterId);
    expect(coreId).toMatch(/^base-builtin:/);
  });
});
