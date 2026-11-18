

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/tests/blueprint-planner/environment-repair.test.ts 第 1 行：
// // @vitest-environment node
// import { expect, it } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { WorldEntity } from "@/domain/document/world-document";
// import { createRegistryContract } from "@/registry";
// import { createRecipeNode } from "@/blueprint-planner/production-network";
// import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
// import type { PlannerNetwork } from "@/blueprint-planner/model";
// import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
// import request from "./fixtures/environment-supply.json";
// import fixture from "./fixtures/environment-fixed-nearest.json";
//
// it("设备和最近环境设施固定时，移动另一台兼容设施恢复覆盖且遵守预算", async () => {
//   const registry = createRegistryContract();
//   const nodes = fixture.nodes.map(entry => {
//     const recipe = registry.queries.findRecipeDefinition(entry.recipeId)!;
//     const node = createRecipeNode(registry, recipe, entry.entity.id, 6,
//       entry.purpose as "production" | "environment");
//     Object.assign(node.entity, structuredClone(entry.entity) as WorldEntity);
//     return node;
//   });
//   const fixed = new Set(fixture.nodes.filter(node => node.locked).map(node => node.entity.id));
//   const before = nodes.filter(node => fixed.has(node.entity.id)).map(node => structuredClone(node.entity));
//   const network: PlannerNetwork = { request: structuredClone(request) as BlueprintPlannerRequest,
//     nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0, deferPowerPlacement: true };
//   const statistics: PlannerSearchStatistics = { seed: 1, evaluationLimit: 500, evaluations: 0,
//     acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
//     outline: fixture.outline, strategy: "compact", experiments: ["constraint-repair"] };
//   const search = new CompactLayoutSearch(registry, network, [], statistics, undefined, undefined, fixed);
//   expect(search.inspectProposal().issues.filter(issue => issue.kind === "environment-coverage")).toHaveLength(2);
//   expect(await search.advance(500, () => {})).toBe(true);
//   search.applyBest();
//   expect(search.inspectProposal().issues).toEqual([]);
//   expect(nodes.filter(node => fixed.has(node.entity.id)).map(node => node.entity)).toEqual(before);
//   expect(statistics.evaluations).toBeGreaterThan(0);
//   expect(statistics.evaluations).toBeLessThanOrEqual(500);
// });
