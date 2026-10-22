// @vitest-environment node
// 2026-10-21：CPU 搜索起点须遵守进入掩码，和缓存重放一致。
// 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe233–235。
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { PlannerRouter } from "@/blueprint-planner/router";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import type { PlannerPort } from "@/blueprint-planner/geometry";

for (const crossed of [false, true]) {
  it(`传送带从管道${crossed ? "桥接器被拒绝" : "直线可合法起步"}，新搜索与重放一致`, async () => {
    const horizontalSource: PlannerPort = { entityId: "hs", groupIndex: 0, portIndex: 0, direction: "output", kind: "pipe",
      cell: { x: -1, y: 2 }, outside: { x: 0, y: 2 }, edge: "EAST" };
    const horizontalTarget: PlannerPort = { ...horizontalSource, entityId: "ht", direction: "input",
      cell: { x: 5, y: 2 }, outside: { x: 4, y: 2 }, edge: "WEST" };
    const verticalSource: PlannerPort = { ...horizontalSource, entityId: "vs",
      cell: { x: 2, y: -1 }, outside: { x: 2, y: 0 }, edge: "SOUTH" };
    const verticalTarget: PlannerPort = { ...horizontalTarget, entityId: "vt",
      cell: { x: 2, y: 5 }, outside: { x: 2, y: 4 }, edge: "NORTH" };
    const source: PlannerPort = { ...horizontalSource, entityId: "source", kind: "belt",
      cell: { x: 2, y: 3 }, outside: { x: 2, y: 2 }, edge: "NORTH" };
    const target: PlannerPort = { ...horizontalTarget, entityId: "target", kind: "belt",
      cell: { x: 1, y: 1 }, outside: { x: 2, y: 1 }, edge: "EAST" };
    const router = new PlannerRouter(createRegistryContract(), [],
      [horizontalSource, horizontalTarget, verticalSource, verticalTarget, source, target],
      { minimumX: 0, minimumY: 0, maximumX: 4, maximumY: 4, escapeLength: 0 });
    await router.connect(horizontalSource, horizontalTarget, () => {});
    if (crossed) await router.connect(verticalSource, verticalTarget, () => {});
    const before = JSON.stringify({ routes: router.routes, entities: router.entities });
    if (crossed) {
      expect(router.reuse(source, target, [{ x: 2, y: 2 }, { x: 2, y: 1 }])).toBe(false);
      await expect(router.connect(source, target, () => {})).rejects.toBeInstanceOf(PlannerCandidateError);
      expect(JSON.stringify({ routes: router.routes, entities: router.entities })).toBe(before);
      expect([...router.conflicts.values()].some(cells => cells.has("2,2"))).toBe(true);
    } else {
      expect(await router.connect(source, target, () => {})).toBe(2);
      expect(router.routes.at(-1)!.cells).toEqual([{ x: 2, y: 2 }, { x: 2, y: 1 }]);
    }
  });
}
