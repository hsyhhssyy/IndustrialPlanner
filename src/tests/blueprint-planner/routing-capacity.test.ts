// @vitest-environment node
// 2026-10-21：DFS 子树可能漏掉横贯布局的瓶颈，补充扫描切面；下界必须保守且不重复统计同一组缺线。
// 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe138 / probe141。
import { expect, it } from "vitest";
import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { PlannerRouter } from "@/blueprint-planner/router";
import { PlannerRoutingGrid } from "@/blueprint-planner/routing-grid";
import { countPlannerRoutingConstraints } from "@/blueprint-planner/routing-capacity";
import type { PlannerWire } from "@/blueprint-planner/model";
import type { PlannerPort } from "@/blueprint-planner/geometry";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import bottleneck from "./fixtures/scan-cut-capacity.json";
import systemReference from "./fixtures/system-capsule-reserved-axes.json";

const registry = createRegistryContract();

it("每条线路独立可达，仍能发现七条必经线争用六条格边", async () => {
  const wires = bottleneck.wires as PlannerWire[], entities = bottleneck.entities as WorldEntity[];
  const ports = wires.flatMap(wire => [wire.source, wire.target]);
  const bounds = { minimumX: 0, minimumY: 0, maximumX: bottleneck.width - 1, maximumY: bottleneck.height - 1, escapeLength: 0 };
  for (const index of bottleneck.provenance.crossingWires) {
    const wire = wires[index]!;
    const independent = new PlannerRouter(registry, entities, ports, bounds);
    expect(await independent.connect(wire.source, wire.target, () => {}, wire.minimumCells)).toBeGreaterThan(0);
  }
  const router = new PlannerRouter(registry, entities, ports, bounds);
  // 2026-10-23：原扫描切面只给出1；共享轴容量补充下界3，组合应取max而非退回较弱切面。
  expect(router.staticConstraints(wires)).toEqual({ disconnectedWires: 0, capacityDeficit: 3 });
});

it("已共同重放的 63 条系统线路不产生容量缺口", () => {
  const seed = systemReference.seed as PlannerSearchSeed;
  const { network, wires } = restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);
  const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
    { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 });
  const key = (port: PlannerPort) => `${port.entityId}/${port.groupIndex}/${port.portIndex}`;
  for (const wire of wires) {
    const path = systemReference.paths.find(route => route.source === key(wire.source) && route.target === key(wire.target));
    expect(path).toBeDefined();
    expect(router.reuse(wire.source, wire.target, path!.cells, wire.minimumCells)).toBe(true);
  }
  expect(router.routes).toHaveLength(63);
  expect(router.staticConstraints(wires)).toEqual({ disconnectedWires: 0, capacityDeficit: 0 });
});

// 独立几何预期：三条连接跨越两道有两个开口的墙，至少缺一条；同一缺口不能按墙数累加。
for (const kind of ["belt", "pipe"] as const) for (const rotated of [false, true]) {
  it(`${kind} 两个重复切面只统计一个缺口，旋转=${rotated}`, () => {
    const grid = new PlannerRoutingGrid(), transform = (x: number, y: number) => rotated ? { x: y, y: x } : { x, y };
    for (const x of [2, 4]) for (let y = 0; y < 7; y++) if (y !== 2 && y !== 4) {
      const p = transform(x, y); grid.block(grid.cell(p.x, p.y), kind === "belt" ? 2 : 1);
    }
    const wires = [1, 3, 5].map(y => {
      const source: PlannerPort = { entityId: `source-${y}`, groupIndex: 0, portIndex: 0, direction: "output", kind,
        cell: transform(-1, y), outside: transform(0, y), edge: rotated ? "SOUTH" : "EAST" };
      const target: PlannerPort = { entityId: `target-${y}`, groupIndex: 0, portIndex: 0, direction: "input", kind,
        cell: transform(7, y), outside: transform(6, y), edge: rotated ? "NORTH" : "WEST" };
      return { source, target };
    });
    expect(countPlannerRoutingConstraints(grid, wires, { x: 0, y: 0, width: 7, height: 7 }))
      .toEqual({ disconnectedWires: 0, capacityDeficit: 1 });
  });
}
