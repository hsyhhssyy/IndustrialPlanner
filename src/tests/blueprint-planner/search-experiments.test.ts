// @vitest-environment node

import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { createPlainNode } from "@/blueprint-planner/placement";
import { PlannerCandidateError, type PlannerNetwork } from "@/blueprint-planner/model";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerPort } from "@/blueprint-planner/geometry";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { DEFAULT_SEARCH_PROFILE } from "@/blueprint-planner/search-profile";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import nugget from "./fixtures/pyrrolite-nugget.json";

it("约束修复遵守总提案预算与固定存取线，最终几何仍由共同评分核验", async () => {
  const registry = createRegistryContract();
  const fixed = createPlainNode(registry, "belt_straight_1x1", "fixed", "bus");
  const moving = createPlainNode(registry, "belt_straight_1x1", "moving", "logistics");
  moving.entity.position = { x: -1, y: -1 };
  const network: PlannerNetwork = { request: structuredClone(nugget.request) as BlueprintPlannerRequest,
    nodes: [fixed, moving], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const statistics: PlannerSearchStatistics = { seed: 0, evaluationLimit: 64, evaluations: 0, acceptedMoves: 0,
    routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 12, height: 12 },
    profile: DEFAULT_SEARCH_PROFILE, experiments: ["constraint-repair"] };
  const search = new CompactLayoutSearch(registry, network, [], statistics);
  expect(await search.advance(128, () => {})).toBe(true);
  search.applyBest();
  expect(statistics.evaluations).toBe(64);
  expect(fixed.entity.position).toEqual({ x: 0, y: 0 });
  expect(moving.entity.position.x).toBeGreaterThanOrEqual(5);
  expect(moving.entity.position.y).toBeGreaterThanOrEqual(0);
  expect(statistics.remainingConflicts).toEqual({ geometry: 0, power: 0, boundary: 0, connections: 0 });
});

it("困难线路排序使用边界、实体和同类端口预留，不把异类端口当作静态墙", () => {
  const registry = createRegistryContract();
  const port = (id: string, x: number, y: number): PlannerPort => ({ entityId: id, groupIndex: 0, portIndex: 0,
    kind: "belt", direction: "output", edge: "SOUTH", cell: { x, y: y - 1 }, outside: { x, y } });
  const narrow = port("narrow", 1, 1), open = port("open", 5, 5), target = port("target", 8, 8);
  const entities = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 1 }].map((position, i) => {
    const node = createPlainNode(registry, "belt_straight_1x1", `wall-${i}`, "logistics");
    node.entity.position = position; return node.entity;
  });
  const boundary = { minimumX: 0, minimumY: 0, maximumX: 10, maximumY: 10, escapeLength: 0 };
  const ports = [narrow, open, target], blocked = port("reserved", 1, 2);
  const router = new PlannerRouter(registry, entities, ports, boundary);
  expect(router.estimateEndpointFreedom(narrow, target)).toBeLessThan(router.estimateEndpointFreedom(open, target));
  const reserved = new PlannerRouter(registry, entities, [...ports, blocked], boundary);
  expect(reserved.estimateEndpointFreedom(narrow, target)).toBe(0);
  const otherKind = new PlannerRouter(registry, entities, [...ports, { ...blocked, kind: "pipe" }], boundary);
  expect(otherKind.estimateEndpointFreedom(narrow, target)).toBeGreaterThan(0);
  expect(router.routes).toEqual([]);
  expect(router.entities).toEqual([]);
});

it("默认供电失败去重通过真实 Worker 执行，每个可行检查点最多拒绝一次供电", async () => {
  const client = new NodePlannerClient();
  try {
    await expect(client.build(structuredClone(nugget.request) as BlueprintPlannerRequest, 9, 120_000,
      { maxEvaluations: 50_000, outline: { width: 30, height: 40 }, diagnostics: true, experiments: undefined }))
      .rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(PlannerCandidateError);
        const search = (error as PlannerCandidateError).search!, diagnostic = search.diagnostics!;
        expect(search.experiments).toEqual(["power-dedup"]);
        expect(search.evaluations).toBe(50_000);
        expect(diagnostic.rejectionCounts.power).toBeGreaterThan(0);
        expect(diagnostic.rejectionCounts.power).toBeLessThanOrEqual(diagnostic.feasibleLayouts);
        expect(diagnostic.fullyRoutedAttempts).toBe(diagnostic.rejectionCounts.power);
        return true;
      });
  } finally { await client.dispose(); }
}, 150_000);
