// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { createRegistryContract } from "@/registry";
import reference from "./fixtures/compact-layout-memory-reference.json";

it("故障任务的六条搜索轨迹在缓冲复用后保持评分、连接、计数及最终布局", async () => {
  const registry = createRegistryContract(), seed = reference.seed as PlannerSearchSeed;
  for (const scenario of reference.cases) {
    const { network, wires } = restorePlannerSeed(registry, JSON.parse(seed.requestKey), seed);
    const statistics: PlannerSearchStatistics = { strategy: scenario.strategy as "baseline" | "compact", seed: 294883,
      evaluationLimit: 512, evaluations: 0, acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
      outline: { width: scenario.size[0]!, height: scenario.size[1]! } };
    const search = new CompactLayoutSearch(registry, network, wires, statistics);
    for (const expected of scenario.trajectory) {
      expect(await search.advance(64, () => {})).toBe(expected.feasible);
      search.applyBest();
      // JSON 参考不含 undefined；只归一化表示，不裁剪任何评分或统计字段。
      expect(JSON.parse(JSON.stringify(statistics))).toEqual(expected.statistics);
      expect(createHash("sha256").update(JSON.stringify(wires)).digest("hex")).toBe(expected.wiresHash);
    }
    expect(network.nodes.map(node => ({ position: node.entity.position, rotation: node.entity.rotation }))).toEqual(scenario.finalPoses);
  }
});
