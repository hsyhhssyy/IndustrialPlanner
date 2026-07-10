import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
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

describe("PortOverlayDecoration 端口语义", () => {
  it("空地出口可合法引出时显示箭头", () => {
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device],
      entityDefinitionMap,
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
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);
    const connectedBelt = createEntity("connected", "belt_straight_1x1", 5, 4, 270);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, connectedBelt],
      entityDefinitionMap,
      kind: "belt",
      direction: "output",
    });

    expect(outputChevronKeys(entries)).toEqual([
      "item_output:out_n_1",
      "item_output:out_n_2",
    ]);
  });

  it("出口正前方横跨已连接传送带时允许创建桥接器并保留箭头", () => {
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);
    const left = createEntity("left", "belt_straight_1x1", 4, 4, 0);
    const crossing = createEntity("crossing", "belt_straight_1x1", 5, 4, 0);
    const right = createEntity("right", "belt_straight_1x1", 6, 4, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, left, crossing, right],
      entityDefinitionMap,
      kind: "belt",
      direction: "output",
    });

    expect(outputChevronKeys(entries)).toContain("item_output:out_n_0");
  });

  it("出口正前方是同轴但方向错误的传送带时隐藏箭头", () => {
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);
    const reversedBelt = createEntity("reversed", "belt_straight_1x1", 5, 4, 90);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, reversedBelt],
      entityDefinitionMap,
      kind: "belt",
      direction: "output",
    });

    expect(outputChevronKeys(entries)).not.toContain("item_output:out_n_0");
  });

  it("出口紧贴另一台设备足印时隐藏箭头", () => {
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);
    const wall = createEntity("wall", "item_port_storager_1", 5, 2, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, wall],
      entityDefinitionMap,
      kind: "belt",
      direction: "output",
    });

    expect(outputChevronKeys(entries)).toEqual([]);
  });

  it("传送带模式将液体端口和输入端口绘制为红叉", () => {
    const device = createEntity("device", "item_port_liquid_filling_pd_mc_1", 5, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device],
      entityDefinitionMap,
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
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);
    const connectedBelt = createEntity("connected", "belt_straight_1x1", 5, 8, 270);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, connectedBelt],
      entityDefinitionMap,
      kind: "belt",
      direction: "output",
    });

    expect(inputCrossKeys(entries)).toEqual([
      "item_input:in_s_1",
      "item_input:in_s_2",
    ]);
  });

  it("方向不匹配的输入端口被设备足印堵塞时不显示叉号", () => {
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);
    const wall = createEntity("wall", "item_port_storager_1", 5, 8, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, wall],
      entityDefinitionMap,
      kind: "belt",
      direction: "output",
    });

    expect(inputCrossKeys(entries)).toEqual([]);
  });

  it("方向不匹配的输入端口可正交桥接时保留叉号", () => {
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);
    const left = createEntity("left", "belt_straight_1x1", 4, 8, 0);
    const crossing = createEntity("crossing", "belt_straight_1x1", 5, 8, 0);
    const right = createEntity("right", "belt_straight_1x1", 6, 8, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, left, crossing, right],
      entityDefinitionMap,
      kind: "belt",
      direction: "output",
    });

    expect(inputCrossKeys(entries)).toContain("item_input:in_s_0");
  });

  it("类型不匹配的液体端口被设备堵塞时不显示叉号", () => {
    const device = createEntity("device", "item_port_liquid_filling_pd_mc_1", 5, 5, 0);
    const wall = createEntity("wall", "item_port_storager_1", 11, 6, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [device, wall],
      entityDefinitionMap,
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
    const liquid = createEntity("liquid", "item_port_liquid_storager_1", 5, 5, 0);
    const gas = createEntity("gas", "item_port_gas_storager_1", 12, 5, 0);

    const entries = resolveLogisticsPortOverlayEntries({
      entities: [liquid, gas],
      entityDefinitionMap,
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

  it("单设备 selection 和 preview 语义下展示全部端口箭头", () => {
    const device = createEntity("device", "item_port_storager_1", 5, 5, 0);

    const entries = resolveSelectedPortOverlayEntries({
      entities: [device],
      selectedEntityIds: new Set([device.id]),
      entityDefinitionMap,
    });

    expect(entries).toHaveLength(6);
    expect(entries.every((entry) => entry.state === "chevron")).toBe(true);
  });

  it("多设备 selection 不展示端口箭头", () => {
    const first = createEntity("first", "item_port_storager_1", 5, 5, 0);
    const second = createEntity("second", "item_port_storager_1", 10, 5, 0);

    const entries = resolveSelectedPortOverlayEntries({
      entities: [first, second],
      selectedEntityIds: new Set([first.id, second.id]),
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
