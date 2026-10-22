// @vitest-environment node
// 2026-10-21：布局连通筛选必须允许垂直穿越其他线路的端点预留，不能排除 Router 已接受的桥接。
// 依据：.docs/common/eda/算法探索/算法探索20261021-系统胶囊蓝图与生产网络搜索空间.md
import { expect, it } from "vitest";
import { PlannerLayoutKernel } from "@/blueprint-planner/cpu-layout";
import type { PlannerLayoutBatch } from "@/blueprint-planner/layout-backend";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/layout-reserved-axis.json";
import systemReference from "./fixtures/system-capsule-reserved-axes.json";

// 数值内核契约夹具：一格宽通道只有一处端点交叉；不冒充 Registry 蓝图或产率验证。
// 独立预期来自通道拓扑，覆盖两种物流、横纵方向、预留轴封锁与实体封锁。
it.each(fixture.cases)("数值布局按轴处理端口预留：$name", row => {
  const input: PlannerLayoutBatch = { ...row.batch, parameters: new Int32Array(row.batch.parameters),
    geometry: new Int32Array(row.batch.geometry), edges: new Int32Array(row.batch.edges),
    overlaps: new Int32Array(row.batch.overlaps), poses: new Int32Array(row.batch.poses) };
  const score = new PlannerLayoutKernel(input).score();
  input.parameters[8] = 0;
  const withoutConnectivity = new PlannerLayoutKernel(input).score();
  expect(score - withoutConnectivity).toBe(row.expectedDisconnected * 10000);
});

it("完整布局筛选接受系统参照中已能重放的 63 条线路，不再误报端点断连", async () => {
  const registry = createRegistryContract(), seed = systemReference.seed as PlannerSearchSeed;
  // 快照的 requestKey 保留原始任务身份，network.request 可以已完成构网所需的计划分组。
  const { network, wires } = restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);
  const statistics: PlannerSearchStatistics = { seed: 1, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
    routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: seed.width, height: seed.height }, strategy: "compact" };
  const search = new CompactLayoutSearch(registry, network, wires, statistics, undefined, undefined,
    new Set(network.nodes.map(node => node.entity.id)));
  expect(await search.advance(0, () => {})).toBe(true);
  expect(statistics.remainingConflicts).toEqual({ geometry: 0, power: 0, boundary: 0, connections: 0 });
  expect(statistics.evaluations).toBe(0);
  expect(seed.width * seed.height).toBe(1032);
  const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
    { minimumX: 0, minimumY: 0, maximumX: seed.width - 1, maximumY: seed.height - 1, escapeLength: 0 });
  for (const wire of wires) {
    const path = systemReference.paths.find(entry => entry.source === `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`
      && entry.target === `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`);
    expect(path).toBeDefined();
    expect(router.reuse(wire.source, wire.target, path!.cells, wire.minimumCells)).toBe(true);
  }
  expect(router.routes).toHaveLength(63);
});
