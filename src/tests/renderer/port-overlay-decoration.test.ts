import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { createRegistryContract } from "@/registry";
import {
  resolveLogisticsPortOverlayEntries,
  resolveSelectedPortOverlayEntries,
  deduplicateEntriesByGridCell,
} from "@/renderer/scene/decorations/PortOverlayDecoration";
import type { PortOverlayEntry } from "@/renderer/scene/decorations/PortOverlayDecoration";

const registry = createRegistryContract();
const entityDefinitionMap = new Map(
  registry.entityDefinitions.map((definition) => [definition.id, definition]),
);
const OVERLAPPING_PORT_DEVICE_CASES = [
  { definitionId: "cheat_infinite_solid", kind: "belt" },
  { definitionId: "cheat_infinite_liquid", kind: "pipe" },
  { definitionId: "cheat_infinite_gas", kind: "pipe" },
  { definitionId: "log_connector", kind: "belt" },
  { definitionId: "pipe_connector", kind: "pipe" },
] as const;

describe("PortOverlayDecoration 端口语义", () => {
  it("空地出口可合法引出时显示箭头", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
      basePlaceableArea: { width: 64, height: 64 },
    });

    expect(outputChevronKeys(entries)).toEqual([
      "item_output:out_n_0",
      "item_output:out_n_1",
      "item_output:out_n_2",
    ]);
  });

  it("方向正确的既有传送带已连接时隐藏对应出口", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);
    const connectedBelt = createEntity("connected", "belt_straight_1x1", 5, 4, 270);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, connectedBelt],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(outputChevronKeys(entries)).toEqual([
      "item_output:out_n_1",
      "item_output:out_n_2",
    ]);
  });

  it("出口正前方横跨已连接传送带时允许创建桥接器并保留箭头", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);
    const left = createEntity("left", "belt_straight_1x1", 4, 4, 0);
    const crossing = createEntity("crossing", "belt_straight_1x1", 5, 4, 0);
    const right = createEntity("right", "belt_straight_1x1", 6, 4, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, left, crossing, right],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(outputChevronKeys(entries)).toContain("item_output:out_n_0");
  });

  it("出口正前方是同轴但方向错误的传送带时隐藏箭头", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);
    const reversedBelt = createEntity("reversed", "belt_straight_1x1", 5, 4, 90);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, reversedBelt],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(outputChevronKeys(entries)).not.toContain("item_output:out_n_0");
  });

  it("出口紧贴另一台设备足印时隐藏箭头", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);
    const wall = createEntity("wall", "storager_1", 5, 2, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, wall],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(outputChevronKeys(entries)).toEqual([]);
  });

  it("传送带模式将液体端口和输入端口绘制为红叉", () => {
    const device = createEntity("device", "liquid_filling_pd_mc_1", 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(entries.some((entry) =>
      entry.state === "cross" && entry.portGroupId === "fluid_input"
    )).toBe(true);
    expect(entries.some((entry) =>
      entry.state === "cross" && entry.portGroupId === "item_input"
    )).toBe(true);
  });

  it("方向不匹配的输入端口已经合法连接时不显示叉号", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);
    const connectedBelt = createEntity("connected", "belt_straight_1x1", 5, 8, 270);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, connectedBelt],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(inputCrossKeys(entries)).toEqual([
      "item_input:in_s_1",
      "item_input:in_s_2",
    ]);
  });

  it("方向不匹配的输入端口被设备足印堵塞时不显示叉号", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);
    const wall = createEntity("wall", "storager_1", 5, 8, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, wall],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(inputCrossKeys(entries)).toEqual([]);
  });

  it("方向不匹配的输入端口可正交桥接时保留叉号", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);
    const left = createEntity("left", "belt_straight_1x1", 4, 8, 0);
    const crossing = createEntity("crossing", "belt_straight_1x1", 5, 8, 0);
    const right = createEntity("right", "belt_straight_1x1", 6, 8, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, left, crossing, right],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(inputCrossKeys(entries)).toContain("item_input:in_s_0");
  });

  it("类型不匹配的液体端口被设备堵塞时不显示叉号", () => {
    const device = createEntity("device", "liquid_filling_pd_mc_1", 5, 5, 0);
    const wall = createEntity("wall", "storager_1", 11, 6, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, wall],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(entries.some((entry) =>
      entry.entityId === "device"
      && entry.state === "cross"
      && entry.portGroupId === "fluid_input"
    )).toBe(false);
  });

  it("管道铺设模式同时展示液体端口和气体端口", () => {
    const liquid = createEntity("liquid", "liquid_storager_1", 5, 5, 0);
    const gas = createEntity("gas", "gas_storager_1", 12, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [liquid, gas],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "pipe",
      direction: "output",
    });

    expect(entries.some((entry) =>
      entry.entityId === "liquid" && entry.portGroupId === "fluid_output" && entry.state === "chevron"
    )).toBe(true);
    expect(entries.some((entry) =>
      entry.entityId === "liquid" && entry.portGroupId === "fluid_input" && entry.state === "cross"
    )).toBe(true);
    expect(entries.some((entry) =>
      entry.entityId === "gas" && entry.portGroupId === "gas_output" && entry.state === "chevron"
    )).toBe(true);
    expect(entries.some((entry) =>
      entry.entityId === "gas" && entry.portGroupId === "gas_input" && entry.state === "cross"
    )).toBe(true);
  });

  for (const deviceCase of OVERLAPPING_PORT_DEVICE_CASES) {
    it(`${deviceCase.definitionId} 在匹配物流模式下将同位置输入叉号和输出箭头聚合为一个箭头`, () => {
      const device = createEntity("device", deviceCase.definitionId, 5, 5, 0);

      const entries = resolveLogisticsPortOverlayEntries({
        entities: [device],
        entityDefinitionMap,
        queries: registry.queries,
        kind: deviceCase.kind,
        direction: "output",
      });

      expect(entries).toHaveLength(4);
      expect(entries.every((entry) =>
        entry.entityId === device.id
        && entry.state === "chevron"
        && entry.direction === "output"
      )).toBe(true);
      expect(new Set(entries.map((entry) => entry.edge))).toEqual(
        new Set(["NORTH", "EAST", "SOUTH", "WEST"]),
      );
    });
  }

  it("起笔后将同位置输出叉号和输入箭头聚合为一个输入箭头", () => {
    const device = createEntity("device", "log_connector", 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "input",
    });

    expect(entries).toHaveLength(4);
    expect(entries.every((entry) =>
      entry.state === "chevron" && entry.direction === "input"
    )).toBe(true);
  });

  it("物流种类不匹配且端口位置可用时每个物理端口只显示一个叉号", () => {
    const device = createEntity("device", "cheat_infinite_solid", 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "pipe",
      direction: "output",
    });

    expect(entries).toHaveLength(4);
    expect(entries.every((entry) => entry.state === "cross")).toBe(true);
  });

  it("草稿占用任一重叠逻辑 Port 时隐藏整个物理端口组", () => {
    const device = createEntity("device", "cheat_infinite_solid", 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
      occupiedDraftPortKeys: new Set(["device:infinite_input:in_n"]),
    });

    expect(entries).toHaveLength(3);
    expect(entries.some((entry) => entry.edge === "NORTH")).toBe(false);
    expect(entries.every((entry) => entry.state === "chevron")).toBe(true);
  });

  it("同一设备投影到相同外侧格但边方向不同的物理端口不互相聚合", () => {
    const definition = createSameOutsideCellDifferentEdgeDefinition();
    const definitionMap = new Map(entityDefinitionMap);
    definitionMap.set(definition.id, definition);
    const device = createEntity("device", definition.id, 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device],
      entityDefinitionMap: definitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.outsideGridPoint)).toEqual([
      { x: 6, y: 5 },
      { x: 6, y: 5 },
    ]);
    expect(new Set(entries.map((entry) => entry.edge))).toEqual(
      new Set(["EAST", "NORTH"]),
    );
  });

  it("不同设备的同位置物理端口不在语义聚合阶段合并", () => {
    const first = createEntity("first", "cheat_infinite_solid", 5, 5, 0);
    const second = createEntity("second", "cheat_infinite_solid", 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [first, second],
      entityDefinitionMap,
      queries: registry.queries,
      kind: "belt",
      direction: "output",
    });

    expect(entries).toHaveLength(8);
    expect(entries.filter((entry) => entry.entityId === first.id)).toHaveLength(4);
    expect(entries.filter((entry) => entry.entityId === second.id)).toHaveLength(4);
  });

  it("单设备 selection 和 preview 语义下展示全部端口箭头", () => {
    const device = createEntity("device", "storager_1", 5, 5, 0);

    const entries = resolveSelectedPortOverlayEntries({
      entities: [device],
      selectedEntityIds: new Set([device.id]),
      entityDefinitionMap,
    });

    expect(entries).toHaveLength(6);
    expect(entries.every((entry) => entry.state === "chevron")).toBe(true);
  });

  it("多设备 selection 不展示端口箭头", () => {
    const first = createEntity("first", "storager_1", 5, 5, 0);
    const second = createEntity("second", "storager_1", 10, 5, 0);

    const entries = resolveSelectedPortOverlayEntries({
      entities: [first, second],
      selectedEntityIds: new Set([first.id, second.id]),
      entityDefinitionMap,
    });

    expect(entries).toEqual([]);
  });

  it("ChevronHidden 设备在单选和 preview 语义下仍不展示端口箭头", () => {
    const device = createEntity("device", "cheat_infinite_solid", 5, 5, 0);

    const entries = resolveSelectedPortOverlayEntries({
      entities: [device],
      selectedEntityIds: new Set([device.id]),
      entityDefinitionMap,
    });

    expect(entries).toEqual([]);
  });
});

describe("deduplicateEntriesByGridCell 触控模式去重", () => {
  it("同一 cell 有箭头和叉号时，过滤叉号保留全部箭头", () => {
    const entries: PortOverlayEntry[] = [
      createChevronEntry("a", 5, 5),
      createCrossEntry("b", 5, 5),
      createChevronEntry("c", 5, 5),
    ];

    const result = deduplicateEntriesByGridCell(entries);

    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.state === "chevron")).toBe(true);
    expect(result.map((entry) => entry.entityId)).toEqual(["a", "c"]);
  });

  it("同一 cell 全是叉号时只保留一个", () => {
    const entries: PortOverlayEntry[] = [
      createCrossEntry("a", 5, 5),
      createCrossEntry("b", 5, 5),
      createCrossEntry("c", 5, 5),
    ];

    const result = deduplicateEntriesByGridCell(entries);

    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe("cross");
    expect(result[0]!.entityId).toBe("a");
  });

  it("不同 cell 的箭头和叉号互不影响", () => {
    const entries: PortOverlayEntry[] = [
      createChevronEntry("a", 5, 5),
      createCrossEntry("b", 6, 6),
      createCrossEntry("c", 6, 6),
    ];

    const result = deduplicateEntriesByGridCell(entries);

    // cell (5,5): 1 个箭头
    // cell (6,6): 两个叉号 → 去重为 1 个
    expect(result).toHaveLength(2);
    expect(result.filter((entry) => entry.state === "chevron")).toHaveLength(1);
    expect(result.filter((entry) => entry.state === "cross")).toHaveLength(1);
  });

  it("空数组返回空数组", () => {
    expect(deduplicateEntriesByGridCell([])).toEqual([]);
  });

  it("同一 cell 多个箭头全部保留", () => {
    const entries: PortOverlayEntry[] = [
      createChevronEntry("a", 5, 5),
      createChevronEntry("b", 5, 5),
      createChevronEntry("c", 5, 5),
    ];

    const result = deduplicateEntriesByGridCell(entries);

    expect(result).toHaveLength(3);
    expect(result.every((entry) => entry.state === "chevron")).toBe(true);
  });
});

function outputChevronKeys(
  entries: ReturnType<typeof resolveLogisticsPortOverlayEntries>,
): string[] {
  return entries
    .filter((entry) =>
      entry.entityId === "device"
      && entry.state === "chevron"
      && entry.direction === "output"
    )
    .map((entry) => `${entry.portGroupId}:${entry.portId}`)
    .sort();
}

function inputCrossKeys(
  entries: ReturnType<typeof resolveLogisticsPortOverlayEntries>,
): string[] {
  return entries
    .filter((entry) =>
      entry.entityId === "device"
      && entry.state === "cross"
      && entry.direction === "input"
    )
    .map((entry) => `${entry.portGroupId}:${entry.portId}`)
    .sort();
}

function createEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"],
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}

function createSameOutsideCellDifferentEdgeDefinition(): EntityDefinition {
  const source = entityDefinitionMap.get("cheat_infinite_solid");
  if (source === undefined) {
    throw new Error("Missing cheat_infinite_solid definition");
  }
  const sourcePortGroup = source.portGroups.find((portGroup) =>
    portGroup.direction === "output"
  );
  const sourcePort = sourcePortGroup?.ports[0];
  if (sourcePortGroup === undefined || sourcePort === undefined) {
    throw new Error("Missing cheat_infinite_solid output port");
  }

  return {
    ...source,
    id: "test_same_outside_cell_different_edge",
    footprint: { width: 2, height: 2 },
    tags: [],
    portGroups: [
      {
        ...sourcePortGroup,
        id: "east_output",
        ports: [{
          ...sourcePort,
          id: "east",
          localCellX: 0,
          localCellY: 0,
          edge: "EAST",
        }],
      },
      {
        ...sourcePortGroup,
        id: "north_output",
        ports: [{
          ...sourcePort,
          id: "north",
          localCellX: 1,
          localCellY: 1,
          edge: "NORTH",
        }],
      },
    ],
  };
}

function createChevronEntry(
  entityId: string,
  x: number,
  y: number,
): PortOverlayEntry {
  return {
    entityId,
    portGroupId: "pg",
    portId: "p",
    outsideGridPoint: { x, y },
    edge: "NORTH",
    material: "solid",
    direction: "output",
    state: "chevron",
  };
}

function createCrossEntry(
  entityId: string,
  x: number,
  y: number,
): PortOverlayEntry {
  return {
    entityId,
    portGroupId: "pg",
    portId: "p",
    outsideGridPoint: { x, y },
    edge: "NORTH",
    material: "solid",
    direction: "output",
    state: "cross",
  };
}
