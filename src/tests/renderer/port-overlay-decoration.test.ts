import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import {
  resolveLogisticsPortOverlayEntries,
  resolveSelectedPortOverlayEntries,
} from "@/renderer/scene/decorations/PortOverlayDecoration";

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
