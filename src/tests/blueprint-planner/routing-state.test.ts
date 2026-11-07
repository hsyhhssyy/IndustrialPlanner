// @vitest-environment node
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerPort } from "@/blueprint-planner/geometry";

const registry = createRegistryContract();
const source: PlannerPort = { entityId: "source", groupIndex: 0, portIndex: 0, direction: "output", kind: "belt",
  cell: { x: 0, y: 3 }, outside: { x: 1, y: 3 }, edge: "EAST" };
const target: PlannerPort = { ...source, entityId: "target", direction: "input", cell: { x: 7, y: 3 }, outside: { x: 6, y: 3 }, edge: "WEST" };
const boundary = { minimumX: 0, minimumY: 0, maximumX: 7, maximumY: 6, escapeLength: 0 };

it("交叉提交后增量阻止再次穿越，并保留冲突的原线路归属", async () => {
  const down: PlannerPort = { ...source, entityId: "down", cell: { x: 3, y: 0 }, outside: { x: 3, y: 1 }, edge: "SOUTH" };
  const up: PlannerPort = { ...target, entityId: "up", cell: { x: 3, y: 6 }, outside: { x: 3, y: 5 }, edge: "NORTH" };
  const router = new PlannerRouter(registry, [], [source, target, down, up], boundary);
  await router.connect(source, target, () => {});
  await router.connect(down, up, () => {});
  expect(router.routes[1]!.cells).toContainEqual({ x: 3, y: 3 });
  expect(router.entities.filter(entity => entity.position.x === 3 && entity.position.y === 3)).toHaveLength(1);
  expect(router.reuse(down, up, router.routes[1]!.cells)).toBe(false);
  await expect(router.connect(source, target, () => {})).rejects.toThrow("物流通道受阻");
  // 同一线路的冲突会被排除；换一个来源编号，检查已占用路径归属未丢失。
  await expect(router.connect({ ...source, entityId: "another" }, target, () => {})).rejects.toThrow("物流通道受阻");
  expect(router.conflicts.has("source/0/0>target/0/0")).toBe(true);
});

it("复用搜索数组后仍满足最短长度与无重复格约束", async () => {
  const router = new PlannerRouter(registry, [], [source, target], boundary);
  await expect(router.connect(source, target, () => { throw new Error("cancelled"); })).rejects.toThrow("cancelled");
  expect(router.entities).toHaveLength(0);
  await router.connect(source, target, () => {}, 12);
  const cells = router.routes[0]!.cells;
  expect(cells.length).toBeGreaterThanOrEqual(12);
  expect(new Set(cells.map(point => `${point.x},${point.y}`)).size).toBe(cells.length);
  expect(new PlannerRouter(registry, [], [source, target], boundary).reuse(source, target, cells, 12)).toBe(true);
});

it("零格直连的复用与首次连接一致，拒绝缓冲不足、错位、异向、异类和双生产设备", async () => {
  const directTarget: PlannerPort = { ...target, cell: { ...source.outside }, outside: { ...source.cell } };
  const logistics = { id: source.entityId, definitionId: registry.queries.resolveLogisticsDefinitionId("belt", "straight"),
    position: { ...source.cell }, rotation: 0 as const, config: {}, tags: [] };
  const initial = new PlannerRouter(registry, [logistics], [source, directTarget], boundary);
  expect(await initial.connect(source, directTarget, () => {})).toBe(0);
  const reused = new PlannerRouter(registry, [logistics], [source, directTarget], boundary);
  expect(reused.reuse(source, directTarget, [], 1)).toBe(false);
  expect(reused.reuse(source, { ...directTarget, cell: { x: 2, y: 3 } }, [])).toBe(false);
  expect(reused.reuse(source, { ...directTarget, edge: "EAST" }, [])).toBe(false);
  expect(reused.reuse(source, { ...directTarget, kind: "pipe" }, [])).toBe(false);
  expect(reused.routes).toHaveLength(0);
  expect(reused.reuse(source, directTarget, [])).toBe(true);
  expect(reused.routes).toEqual(initial.routes);
  expect(reused.entities).toHaveLength(0);
  const productionOnly = new PlannerRouter(registry, [], [source, directTarget], boundary);
  expect(productionOnly.reuse(source, directTarget, [])).toBe(false);
  await expect(productionOnly.connect(source, directTarget, () => {})).rejects.toThrow("两个非物流设备");
});

it("历史惩罚仍影响路径，负坐标及很大坐标不导致整图预分配", async () => {
  const router = new PlannerRouter(registry, [], [source, target], { ...boundary,
    history: new Map([["source/0/0>target/0/0|3,3", 100]]) });
  await router.connect(source, target, () => {});
  expect(router.routes[0]!.cells).not.toContainEqual({ x: 3, y: 3 });
  for (const offset of [-100, 100_000_000]) {
    const move = (port: PlannerPort): PlannerPort => ({ ...port,
      cell: { x: port.cell.x + offset, y: port.cell.y - 10 }, outside: { x: port.outside.x + offset, y: port.outside.y - 10 } });
    const a = move(source), b = move(target);
    const shifted = new PlannerRouter(registry, [], [a, b], { minimumX: offset, minimumY: -10,
      maximumX: offset + 7, maximumY: -4, escapeLength: 0 });
    await shifted.connect(a, b, () => {});
    expect(shifted.routes[0]!.cells).toEqual(Array.from({ length: 6 }, (_, i) => ({ x: offset + i + 1, y: -7 })));
  }
});
