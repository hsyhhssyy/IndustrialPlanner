// @vitest-environment node

import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { createPlainNode } from "@/blueprint-planner/placement";
import { PlannerCandidateError, type PlannerNetwork } from "@/blueprint-planner/model";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerPort } from "@/blueprint-planner/geometry";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { DEFAULT_SEARCH_PROFILE } from "@/blueprint-planner/search-profile";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import nugget from "./fixtures/pyrrolite-nugget.json";
import powerNoSpace from "./fixtures/power-no-space.json";

it("约束修复遵守总提案预算与边界接入，最终几何仍由共同评分核验", async () => {
  const registry = createRegistryContract();
  const fixed = createPlainNode(registry, "unloader_1", "warehouse-port", "supply");
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
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: 下方边界约束验证；仓库口可移动，盒内不再预留存取线条带。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//   expect(fixed.entity.position).toEqual({ x: 0, y: 0 });
//   expect(moving.entity.position.x).toBeGreaterThanOrEqual(5);
  const boundary = new PlannerBoundary(registry, network, statistics.outline);
  expect(boundary.resolve(network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }))).violations).toBe(0);
  expect(moving.entity.position.x).toBeGreaterThanOrEqual(0);
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

it("基线策略的默认供电失败去重通过真实 Worker 执行，每个可行检查点最多拒绝一次供电", async () => {
  const client = new NodePlannerClient();
  try {
    // 2026-09-30：重叠规则修复改变了旧随机样本的失败阶段；使用专门缺少 2×2 桩位的固定场景验证相同去重契约。
    await expect(client.build(structuredClone(powerNoSpace.request) as BlueprintPlannerRequest, 0, 30_000,
      { strategy: "baseline", maxEvaluations: 5_000, outline: powerNoSpace.outline, diagnostics: true, experiments: undefined,
        // AI-CORRECTION 2026-10-11：固定初排以进入供电拒绝分支；新随机初排可能找到供电位置。
        // AI-CORRECTION 2026-10-17：布局流 0 停在端口冲突，布局流 2 可稳定完成 6 次布线并拒绝供电；保留 8×4 和全部语义断言。
        stashPackingVariant: 0, attemptStrategy: { ...plannerAttemptStrategy(0), placementSeed: 0, boundarySeed: 0,
          layoutSeed: 2, converterSeed: 0, conduitTopology: "shared" } }))
      .rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(PlannerCandidateError);
        const search = (error as PlannerCandidateError).search!, diagnostic = search.diagnostics!;
        expect(search.experiments).toEqual(["power-dedup"]);
        expect(search.evaluations).toBe(5_000);
        expect(diagnostic.rejectionCounts.power).toBeGreaterThan(0);
        expect(diagnostic.rejectionCounts.power).toBeLessThanOrEqual(diagnostic.feasibleLayouts);
        expect(diagnostic.fullyRoutedAttempts).toBe(diagnostic.rejectionCounts.power);
        return true;
      });
  } finally { await client.dispose(); }
}, 150_000);

// AI-REMOVED 2026-10-26:
// Reason: 撤下后续首解专用实验自动开关；保留显式约束修复、边界排序和原有供电去重验证。
// Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// Evidence: src/tests/blueprint-planner/search-experiments.test.ts；原文件 SHA256 6404253863525f858e5c8c7659d00b07de41f1cf3480b792f50f5770f2652870。
// Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// Human Review: Required
// Original code:
// // @vitest-environment node
//
// import { expect, it } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createRegistryContract } from "@/registry";
// import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
// import { PlannerBoundary } from "@/blueprint-planner/boundary";
// import { createPlainNode } from "@/blueprint-planner/placement";
// import { PlannerCandidateError, type PlannerNetwork } from "@/blueprint-planner/model";
// import { PlannerRouter } from "@/blueprint-planner/router";
// import type { PlannerPort } from "@/blueprint-planner/geometry";
// import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// import { DEFAULT_SEARCH_PROFILE } from "@/blueprint-planner/search-profile";
// import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
// import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
// import nugget from "./fixtures/pyrrolite-nugget.json";
// import powerNoSpace from "./fixtures/power-no-space.json";
//
// // AI-CORRECTION 2026-10-17：紧凑首解使用零间距，靠高温与约束权重找可布线构型；复制子网参数单独保留。
// it("首解与续搜使用紧凑通道策略，所有分支遵守提案预算", async () => {
//   const client = new NodePlannerClient();
//   try {
//     for (const [firstSolution, restart, clearance] of [[true, false, 0], [true, true, 0], [false, false, 0]] as const) {
//       let statistics: PlannerSearchStatistics | undefined;
//       try {
//         statistics = (await client.build(nugget.request as BlueprintPlannerRequest, 0, 30_000,
//           { firstSolution, maxEvaluations: 1, targetOutline: { width: 70, height: 70 },
//             attemptStrategy: { ...plannerAttemptStrategy(0), restart } })).search;
//       } catch (error) {
//         expect(error).toBeInstanceOf(PlannerCandidateError);
//         statistics = (error as PlannerCandidateError).search;
//       }
//       expect(statistics?.profile?.routingClearance).toBe(clearance);
//       expect(statistics?.evaluations).toBeLessThanOrEqual(1);
//       expect(statistics?.experiments).toEqual(firstSolution && !restart
//         ? ["constraint-repair", "power-dedup", "constrained-routing"] : ["power-dedup"]);
//     }
//   } finally { await client.dispose(); }
// }, 150_000);
//
// it("约束修复遵守总提案预算与边界接入，最终几何仍由共同评分核验", async () => {
//   const registry = createRegistryContract();
//   const fixed = createPlainNode(registry, "unloader_1", "warehouse-port", "supply");
//   const moving = createPlainNode(registry, "belt_straight_1x1", "moving", "logistics");
//   moving.entity.position = { x: -1, y: -1 };
//   const network: PlannerNetwork = { request: structuredClone(nugget.request) as BlueprintPlannerRequest,
//     nodes: [fixed, moving], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
//   const statistics: PlannerSearchStatistics = { seed: 0, evaluationLimit: 64, evaluations: 0, acceptedMoves: 0,
//     routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: { width: 12, height: 12 },
//     profile: DEFAULT_SEARCH_PROFILE, experiments: ["constraint-repair"] };
//   const search = new CompactLayoutSearch(registry, network, [], statistics);
//   expect(await search.advance(128, () => {})).toBe(true);
//   search.applyBest();
//   expect(statistics.evaluations).toBe(64);
// // AI-REMOVED 2026-10-05:
// // Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// // Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// // Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// // Replacement: 下方边界约束验证；仓库口可移动，盒内不再预留存取线条带。
// // Risk: 旧搜索种子失效，按算法版本重置。
// // Human Review: Required
// // Original code:
// //   expect(fixed.entity.position).toEqual({ x: 0, y: 0 });
// //   expect(moving.entity.position.x).toBeGreaterThanOrEqual(5);
//   const boundary = new PlannerBoundary(registry, network, statistics.outline);
//   expect(boundary.resolve(network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }))).violations).toBe(0);
//   expect(moving.entity.position.x).toBeGreaterThanOrEqual(0);
//   expect(moving.entity.position.y).toBeGreaterThanOrEqual(0);
//   expect(statistics.remainingConflicts).toEqual({ geometry: 0, power: 0, boundary: 0, connections: 0 });
// });
//
// it("困难线路排序使用边界、实体和同类端口预留，不把异类端口当作静态墙", () => {
//   const registry = createRegistryContract();
//   const port = (id: string, x: number, y: number): PlannerPort => ({ entityId: id, groupIndex: 0, portIndex: 0,
//     kind: "belt", direction: "output", edge: "SOUTH", cell: { x, y: y - 1 }, outside: { x, y } });
//   const narrow = port("narrow", 1, 1), open = port("open", 5, 5), target = port("target", 8, 8);
//   const entities = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 1 }].map((position, i) => {
//     const node = createPlainNode(registry, "belt_straight_1x1", `wall-${i}`, "logistics");
//     node.entity.position = position; return node.entity;
//   });
//   const boundary = { minimumX: 0, minimumY: 0, maximumX: 10, maximumY: 10, escapeLength: 0 };
//   const ports = [narrow, open, target], blocked = port("reserved", 1, 2);
//   const router = new PlannerRouter(registry, entities, ports, boundary);
//   expect(router.estimateEndpointFreedom(narrow, target)).toBeLessThan(router.estimateEndpointFreedom(open, target));
//   const reserved = new PlannerRouter(registry, entities, [...ports, blocked], boundary);
//   expect(reserved.estimateEndpointFreedom(narrow, target)).toBe(0);
//   const otherKind = new PlannerRouter(registry, entities, [...ports, { ...blocked, kind: "pipe" }], boundary);
//   expect(otherKind.estimateEndpointFreedom(narrow, target)).toBeGreaterThan(0);
//   expect(router.routes).toEqual([]);
//   expect(router.entities).toEqual([]);
// });
//
// it("基线策略的默认供电失败去重通过真实 Worker 执行，每个可行检查点最多拒绝一次供电", async () => {
//   const client = new NodePlannerClient();
//   try {
//     // 2026-09-30：重叠规则修复改变了旧随机样本的失败阶段；使用专门缺少 2×2 桩位的固定场景验证相同去重契约。
//     await expect(client.build(structuredClone(powerNoSpace.request) as BlueprintPlannerRequest, 0, 30_000,
//       { strategy: "baseline", maxEvaluations: 5_000, outline: powerNoSpace.outline, diagnostics: true, experiments: undefined,
//         // AI-CORRECTION 2026-10-11：固定初排以进入供电拒绝分支；新随机初排可能找到供电位置。
//         // AI-CORRECTION 2026-10-17：布局流 0 停在端口冲突，布局流 2 可稳定完成 6 次布线并拒绝供电；保留 8×4 和全部语义断言。
//         stashPackingVariant: 0, attemptStrategy: { ...plannerAttemptStrategy(0), placementSeed: 0, boundarySeed: 0,
//           layoutSeed: 2, converterSeed: 0, conduitTopology: "shared" } }))
//       .rejects.toSatisfy((error: unknown) => {
//         expect(error).toBeInstanceOf(PlannerCandidateError);
//         const search = (error as PlannerCandidateError).search!, diagnostic = search.diagnostics!;
//         expect(search.experiments).toEqual(["power-dedup"]);
//         expect(search.evaluations).toBe(5_000);
//         expect(diagnostic.rejectionCounts.power).toBeGreaterThan(0);
//         expect(diagnostic.rejectionCounts.power).toBeLessThanOrEqual(diagnostic.feasibleLayouts);
//         expect(diagnostic.fullyRoutedAttempts).toBe(diagnostic.rejectionCounts.power);
//         return true;
//       });
//   } finally { await client.dispose(); }
// }, 150_000);
//
