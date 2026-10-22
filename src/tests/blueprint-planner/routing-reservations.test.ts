// @vitest-environment node
// 2026-10-21：系统胶囊图的八个桥接格位于其他线路端点，端点预留不能封锁垂直直穿。
// 依据：.docs/common/eda/算法探索/算法探索20261021-系统胶囊蓝图与生产网络搜索空间.md
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { PlannerRouter } from "@/blueprint-planner/router";
import { findLogisticsDevice, type PlannerPort } from "@/blueprint-planner/geometry";

const registry = createRegistryContract();
const bounds = { minimumX: 0, minimumY: 0, maximumX: 4, maximumY: 4, escapeLength: 0 };
const horizontalSource: PlannerPort = { entityId: "horizontal-source", groupIndex: 0, portIndex: 0,
  direction: "output", kind: "belt", cell: { x: -1, y: 2 }, outside: { x: 0, y: 2 }, edge: "EAST" };
const horizontalTarget: PlannerPort = { ...horizontalSource, entityId: "horizontal-target", direction: "input",
  cell: { x: 5, y: 2 }, outside: { x: 4, y: 2 }, edge: "WEST" };
const verticalSource: PlannerPort = { ...horizontalSource, entityId: "vertical-source",
  cell: { x: 2, y: 1 }, outside: { x: 2, y: 2 }, edge: "SOUTH" };
const verticalTarget: PlannerPort = { ...horizontalTarget, entityId: "vertical-target",
  cell: { x: 2, y: 4 }, outside: { x: 2, y: 3 }, edge: "NORTH" };
const horizontalCells = [0, 1, 2, 3, 4].map(x => ({ x, y: 2 }));
const verticalCells = [{ x: 2, y: 2 }, { x: 2, y: 3 }];

for (const kind of ["belt", "pipe"] as const) {
  it.each([false, true])(`${kind} 允许直线通过另一线路端点，反向提交顺序为 %s`, async reversed => {
    const [from, to, crossFrom, crossTo] = [horizontalSource, horizontalTarget, verticalSource, verticalTarget]
      .map(port => ({ ...port, kind })) as [PlannerPort, PlannerPort, PlannerPort, PlannerPort];
    const pairs = [{ source: from, target: to, cells: horizontalCells }, { source: crossFrom, target: crossTo, cells: verticalCells }];
    if (reversed) pairs.reverse();
    const replay = new PlannerRouter(registry, [], [from, to, crossFrom, crossTo], bounds);
    const search = new PlannerRouter(registry, [], [from, to, crossFrom, crossTo], bounds);
    for (const pair of pairs) {
      expect(replay.reuse(pair.source, pair.target, pair.cells)).toBe(true);
      expect(await search.connect(pair.source, pair.target, () => {})).toBe(pair.cells.length);
    }
    for (const router of [replay, search]) {
      expect(router.routes).toHaveLength(2);
      expect(router.entities.find(entity => entity.position.x === 2 && entity.position.y === 2)?.definitionId)
        .toBe(findLogisticsDevice(registry, kind, "connector").id);
    }
  });
}

it("预留轴不能被其他线路顺向占用，垂直经过也不能在该格转弯", () => {
  const parallelPin: PlannerPort = { ...horizontalSource, entityId: "reserved-parallel",
    cell: { x: 1, y: 2 }, outside: { x: 2, y: 2 } };
  const parallel = new PlannerRouter(registry, [], [horizontalSource, horizontalTarget, parallelPin], bounds);
  expect(parallel.reuse(horizontalSource, horizontalTarget, horizontalCells)).toBe(false);
  expect(parallel.entities).toHaveLength(0);
  const turnTarget: PlannerPort = { ...verticalTarget, entityId: "turn-target",
    cell: { x: 2, y: -1 }, outside: { x: 2, y: 0 }, edge: "SOUTH" };
  const corner = new PlannerRouter(registry, [], [horizontalSource, turnTarget, verticalSource], bounds);
  expect(corner.reuse(horizontalSource, turnTarget, [
    { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 0 },
  ])).toBe(false);
  expect(corner.entities).toHaveLength(0);
});
