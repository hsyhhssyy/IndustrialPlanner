import { loadBlueprintFromFile, getBlueprintEntityArray } from "@/tests/simulation/blueprint-test-helpers";
import { describe, expect, it } from "vitest";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { createRegistryContract } from "@/registry";
import { resolveLogisticsMaterialTopology } from "@/renderer/scene/logistics-material-topology";

const registry = createRegistryContract();
const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
const straight = definitions.get("pipe_straight_1x1")!;

function pipe(id: string, x: number, draft = false): WorldEntity {
  return { id, definitionId: straight.id, position: { x, y: 0 }, rotation: 0, config: {}, tags: [],
    ...(draft ? { originalEntityId: id } : {}),
  };
}

function topology(entities: readonly WorldEntity[], extra: readonly EntityDefinition[] = []) {
  return resolveLogisticsMaterialTopology({ entities,
    definitions: new Map([...definitions, ...extra.map((definition) => [definition.id, definition] as const)]),
    registry: registry.queries,
  });
}

describe("物流材质线路与设备端点", () => {
  it("虚影接续正式线路的六格箭头相位，不进入仿真运输组", () => {
    const entities = Array.from({ length: 16 }, (_, index) => pipe(`${index < 5 ? "real" : "draft"}-${index}`, index, index >= 5));
    const result = topology(entities);
    expect(result.committed.size).toBe(5);
    expect(result.previewIds.size).toBe(11);
    expect([...result.placements.values()].filter((entry) => entry.marker).map((entry) => entry.start)).toEqual([3, 9, 15]);
    expect(result.placements.get("draft-5")?.start).toBe(5);
    expect(result.placements.get("real-4")?.support).toBe(false);
    expect(result.committed.get("real-4")?.support).toBe(true);
  });

  it("重叠起笔虚影替换正式节参与预览，取消虚影后恢复原线路", () => {
    const actual = Array.from({ length: 8 }, (_, index) => pipe(`real-${index}`, index));
    const projected = topology([...actual, pipe("draft-4", 4, true), pipe("draft-5", 5, true)]);
    expect(projected.placements.get("draft-4")?.start).toBe(4);
    expect(projected.placements.get("draft-5")?.start).toBe(5);
    expect(projected.committed.get("real-4")?.routeId).toBe("real-0");
    expect(topology(actual).previewIds.size).toBe(0);
    expect(topology(actual).placements.get("real-4")?.start).toBe(4);
  });

  it("相邻反向端口不会被当作已接设备，其他线路的几何接近也不影响支架", () => {
    const a = Array.from({ length: 70 }, (_, index) => pipe(`a-${index}`, index));
    const b = Array.from({ length: 8 }, (_, index) => ({ ...pipe(`b-${index}`, index), position: { x: index, y: 1 } }));
    const placements = topology([...a, ...b]).placements;
    expect([...placements].filter(([id, entry]) => id.startsWith("a-") && entry.support).map(([, entry]) => entry.start))
      .toEqual([0, 30, 69]);
    expect(placements.get("b-0")?.routeId).toBe("b-0");
  });

  it("使用真实端口旋转与方向判断设备连接，不按设备占地邻接猜测", () => {
    const portGroup = straight.portGroups.find((group) => group.direction === "output")!;
    const device: EntityDefinition = {
      ...straight, id: "material-output", spriteId: "material-output", footprint: { width: 3, height: 2 },
      portGroups: [{ ...portGroup, ports: [{ ...portGroup.ports[0]!, localCellX: 1, localCellY: 0, edge: "NORTH" }] }],
    };
    const sink: EntityDefinition = { ...device, id: "material-input", spriteId: "material-input",
      portGroups: device.portGroups.map((group) => ({ ...group, direction: "input" })),
    };
    const sourceEntity: WorldEntity = { ...pipe("source", -2), definitionId: device.id, position: { x: -2, y: -1 }, rotation: 90 };
    const targetEntity: WorldEntity = { ...pipe("target", 3), definitionId: sink.id, position: { x: 3, y: -1 }, rotation: 270 };
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections-extra/renderer/logistics-material-topology/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [pipe("p0", 0), pipe("p1", 1), pipe("p2", 2)]
    const pipes = getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/renderer/logistics-material-topology/scene-01-variant-1.schema6.json"));
    const connected = topology([...pipes, sourceEntity, targetEntity], [device, sink]);
    expect([...connected.placements.values()].every((entry) => !entry.support)).toBe(true);
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/collections/renderer/logistics-material-topology/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // [...pipes, { ...sourceEntity, definitionId: sink.id }, targetEntity]
    const reversed = topology(getBlueprintEntityArray(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/renderer/logistics-material-topology/scene-01-variant-1.schema6.json")), [device, sink]);
    expect(reversed.placements.get("p0")?.support).toBe(true);
    expect(reversed.placements.get("p2")?.support).toBe(false);
  });
});
