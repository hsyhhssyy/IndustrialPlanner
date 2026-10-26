// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PlannerRandom, plannerRandomSeed, plannerRandomStep } from "@/blueprint-planner/search-random";
import { nextPlannerStrategy, assertPlannerStrategyStates, plannerAttemptStrategy, type PlannerDimensionRandomState } from "@/blueprint-planner/strategy-schedule";
import { warehouseCountRequest } from "@/blueprint-planner/warehouse-port-schedule";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import input from "./fixtures/yazhen-syringe.json";

describe("按尺寸独立的策略随机流", () => {

  it("xorshift32 与参考序列一致，零状态被拒绝且快照续接相同", () => {
    const random = new PlannerRandom(1);
    expect(Array.from({ length: 5 }, () => random.next())).toEqual([270369, 67634689, 2647435461, 307599695, 2398689233]);
    const restored = new PlannerRandom(JSON.parse(JSON.stringify(random.state)) as number);
    expect(Array.from({ length: 100 }, () => restored.next())).toEqual(Array.from({ length: 100 }, () => random.next()));
    for (const state of [0, -1, 2 ** 32, NaN, 1.5]) expect(() => new PlannerRandom(state)).toThrow("随机状态");
    for (const identity of ["0", "32", "4294967295"]) expect(plannerRandomSeed(identity)).toBeGreaterThan(0);
  });

  it("两个或四个尺寸交替访问时，各自覆盖冷启动、删减和全部供水拓扑", () => {
    for (const dimensions of [2, 4]) {
      const states: Record<string, PlannerDimensionRandomState> = {};
      const seen = Array.from({ length: dimensions }, () => [] as ReturnType<typeof nextPlannerStrategy>["strategy"][]);
      for (let attempt = 0; attempt < dimensions * 24; attempt++) {
        const index = attempt % dimensions, key = `${24 + index}/23/any/any`;
        const next = nextPlannerStrategy(123, key, states[key]);
        states[key] = next.state; seen[index]!.push(next.strategy);
      }
      for (const choices of seen) {
        for (let offset = 0; offset < choices.length; offset += 4) expect(choices.slice(offset, offset + 4).filter(choice => choice.restart)).toHaveLength(1);
        for (let offset = 0; offset < choices.length; offset += 2) expect(new Set(choices.slice(offset, offset + 2).map(choice => choice.reduce)).size).toBe(2);
        for (let offset = 0; offset < choices.length; offset += 3) expect(new Set(choices.slice(offset, offset + 3).map(choice => choice.conduitTopology)).size).toBe(3);
        expect(new Set(choices.map(choice => `${choice.restart}/${choice.reduce}`)).size).toBe(4);
      }
      expect(() => assertPlannerStrategyStates(states, dimensions * 24)).not.toThrow();
    }
  });

  it("其他尺寸及布局随机消耗不改变本尺寸序列，JSON 恢复不重复首轮", () => {
    const seed = plannerRandomSeed("saved-task"), key = "26/23/any/any";
    let state: PlannerDimensionRandomState | undefined;
    for (let visit = 0; visit < 7; visit++) state = nextPlannerStrategy(seed, key, state).state;
    const before = JSON.stringify(state);
    const restored = JSON.parse(before) as PlannerDimensionRandomState;
    const expected = nextPlannerStrategy(seed, key, state);
    let other: PlannerDimensionRandomState | undefined;
    for (let visit = 0; visit < 64; visit++) {
      const next = nextPlannerStrategy(seed, "25/24/any/any", other); other = next.state;
      const layout = new PlannerRandom(next.strategy.layoutSeed);
      for (let step = 0; step < visit; step++) layout.next();
    }
    expect(nextPlannerStrategy(seed, key, restored)).toEqual(expected);
    expect(JSON.stringify(state)).toBe(before);
    expect(expected.state.visits).toBe(8);
  });

  it("固定步长的直接调用也不固定策略，随机整数选择覆盖全部选项", () => {
    const choices = Array.from({ length: 256 }, (_, index) => plannerAttemptStrategy(8 + index * 32));
    expect(new Set(choices.map(choice => choice.reduce)).size).toBe(2);
    expect(new Set(choices.map(choice => choice.restart)).size).toBe(2);
    expect(new Set(choices.map(choice => choice.conduitTopology)).size).toBe(3);
    expect(new Set(choices.map(choice => `${choice.reduce}/${choice.boundarySeed % 4}`)).size).toBe(8);
    const random = new PlannerRandom(17);
    for (const size of [2, 3, 4, 8, 16, 32]) expect(new Set(Array.from({ length: 1024 }, () => random.integer(size))).size).toBe(size);
  });

  it("拒绝篡改状态、轮转表和超额访问计数", () => {
    const key = "26/23/any/any", { state } = nextPlannerStrategy(123, key);
    for (const invalid of [{ ...state, state: 0 }, { ...state, reductions: [0, 1] },
      { ...state, restarts: [1, 1, 1] }, { ...state, topologies: [9, 0] }]) {
      expect(() => assertPlannerStrategyStates({ [key]: invalid }, 1)).toThrow();
    }
    expect(() => assertPlannerStrategyStates({ [key]: state }, 0)).toThrow("超过");
  });

  it("超过 32 位的产物组合仍能随机探索，并保持指定存货口数量", () => {
    const random = new PlannerRandom(19), limit = 1n << 60n;
    const ranks = Array.from({ length: 32 }, () => random.bigint(limit));
    expect(ranks.every(rank => rank >= 0 && rank < limit)).toBe(true);
    expect(ranks.some(rank => rank > 0xffffffffn)).toBe(true);
    const profile = { pickupLength: 0, fixedStorageCount: 0, storageLength: 1,
      automatic: Array.from({ length: 40 }, (_, index) => ({ itemId: `product-${index}`, count: 1 })) };
    const request = structuredClone(input.request) as BlueprintPlannerRequest;
    const combinations = Array.from({ length: 32 }, () => warehouseCountRequest(request, profile, 20, random));
    for (const combination of combinations) expect(combination.options.itemPolicies!.filter(policy => policy.output === "warehouse")).toHaveLength(20);
    expect(combinations.some(combination => combination.options.itemPolicies!.find(policy => policy.itemId === "product-0")!.output === "warehouse")).toBe(true);
    expect(combinations.some(combination => combination.options.itemPolicies!.find(policy => policy.itemId === "product-0")!.output === "stash")).toBe(true);
  });

  it("共用步进器不改变 CPU / GPU 约定的无符号状态转换", () => {
    const random = new PlannerRandom(0xffffffff);
    expect(plannerRandomStep(0xffffffff)).toBe(253983);
    expect(random.next()).toBe(253983);
    expect(random.state).toBeGreaterThan(0);
    expect(random.state).toBeLessThanOrEqual(0xffffffff);
  });
});

// AI-REMOVED 2026-10-26:
// Reason: 同步撤下已移除搜索能力的专用用例；保留旧内核仍支持的随机流、严格缩面积与面积边界断言。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/strategy-schedule.test.ts；原文件 SHA256 3d1ea89b97c913e765650436c134fa58c01d57d77d017a0033689cd0cf247e97。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// import { describe, expect, it } from "vitest";
// import { PlannerRandom, plannerRandomSeed, plannerRandomStep } from "@/blueprint-planner/search-random";
// import { nextPlannerStrategy, assertPlannerStrategyStates, plannerAttemptStrategy, plannerConnectionChoices,
//   type PlannerDimensionRandomState } from "@/blueprint-planner/strategy-schedule";
// import { warehouseCountRequest } from "@/blueprint-planner/warehouse-port-schedule";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import input from "./fixtures/yazhen-syringe.json";
//
// describe("按尺寸独立的策略随机流", () => {
//   // 2026-10-21：构网结构选择使用原连接种子，不增加检查点字段、不消耗尺寸 PRNG。
//   it("供液备用口与合流形状独立组合，重复解析不改变下一批策略", () => {
//     const before = nextPlannerStrategy(123, "24/20/any/any");
//     const combos = new Set(Array.from({ length: 256 }, (_, variant) => {
//       const strategy = plannerAttemptStrategy(variant), choice = plannerConnectionChoices(strategy.matchingSeed);
//       expect(plannerConnectionChoices(strategy.matchingSeed)).toEqual(choice);
//       return `${choice.spareSupplyPorts}/${choice.serialConvergers}`;
//     }));
//     expect(combos.size).toBe(4);
//     expect(nextPlannerStrategy(123, "24/20/any/any")).toEqual(before);
//   });
//
//   it("xorshift32 与参考序列一致，零状态被拒绝且快照续接相同", () => {
//     const random = new PlannerRandom(1);
//     expect(Array.from({ length: 5 }, () => random.next())).toEqual([270369, 67634689, 2647435461, 307599695, 2398689233]);
//     const restored = new PlannerRandom(JSON.parse(JSON.stringify(random.state)) as number);
//     expect(Array.from({ length: 100 }, () => restored.next())).toEqual(Array.from({ length: 100 }, () => random.next()));
//     for (const state of [0, -1, 2 ** 32, NaN, 1.5]) expect(() => new PlannerRandom(state)).toThrow("随机状态");
//     for (const identity of ["0", "32", "4294967295"]) expect(plannerRandomSeed(identity)).toBeGreaterThan(0);
//   });
//
//   it("两个或四个尺寸交替访问时，各自覆盖冷启动、删减和全部供水拓扑", () => {
//     for (const dimensions of [2, 4]) {
//       const states: Record<string, PlannerDimensionRandomState> = {};
//       const seen = Array.from({ length: dimensions }, () => [] as ReturnType<typeof nextPlannerStrategy>["strategy"][]);
//       for (let attempt = 0; attempt < dimensions * 24; attempt++) {
//         const index = attempt % dimensions, key = `${24 + index}/23/any/any`;
//         const next = nextPlannerStrategy(123, key, states[key]);
//         states[key] = next.state; seen[index]!.push(next.strategy);
//       }
//       for (const choices of seen) {
//         for (let offset = 0; offset < choices.length; offset += 4) expect(choices.slice(offset, offset + 4).filter(choice => choice.restart)).toHaveLength(1);
//         for (let offset = 0; offset < choices.length; offset += 2) expect(new Set(choices.slice(offset, offset + 2).map(choice => choice.reduce)).size).toBe(2);
//         for (let offset = 0; offset < choices.length; offset += 3) expect(new Set(choices.slice(offset, offset + 3).map(choice => choice.conduitTopology)).size).toBe(3);
//         expect(new Set(choices.map(choice => `${choice.restart}/${choice.reduce}`)).size).toBe(4);
//       }
//       expect(() => assertPlannerStrategyStates(states, dimensions * 24)).not.toThrow();
//     }
//   });
//
//   it("其他尺寸及布局随机消耗不改变本尺寸序列，JSON 恢复不重复首轮", () => {
//     const seed = plannerRandomSeed("saved-task"), key = "26/23/any/any";
//     let state: PlannerDimensionRandomState | undefined;
//     for (let visit = 0; visit < 7; visit++) state = nextPlannerStrategy(seed, key, state).state;
//     const before = JSON.stringify(state);
//     const restored = JSON.parse(before) as PlannerDimensionRandomState;
//     const expected = nextPlannerStrategy(seed, key, state);
//     let other: PlannerDimensionRandomState | undefined;
//     for (let visit = 0; visit < 64; visit++) {
//       const next = nextPlannerStrategy(seed, "25/24/any/any", other); other = next.state;
//       const layout = new PlannerRandom(next.strategy.layoutSeed);
//       for (let step = 0; step < visit; step++) layout.next();
//     }
//     expect(nextPlannerStrategy(seed, key, restored)).toEqual(expected);
//     expect(JSON.stringify(state)).toBe(before);
//     expect(expected.state.visits).toBe(8);
//   });
//
//   it("固定步长的直接调用也不固定策略，随机整数选择覆盖全部选项", () => {
//     const choices = Array.from({ length: 256 }, (_, index) => plannerAttemptStrategy(8 + index * 32));
//     expect(new Set(choices.map(choice => choice.reduce)).size).toBe(2);
//     expect(new Set(choices.map(choice => choice.restart)).size).toBe(2);
//     expect(new Set(choices.map(choice => choice.conduitTopology)).size).toBe(3);
//     expect(new Set(choices.map(choice => `${choice.reduce}/${choice.boundarySeed % 4}`)).size).toBe(8);
//     const random = new PlannerRandom(17);
//     for (const size of [2, 3, 4, 8, 16, 32]) expect(new Set(Array.from({ length: 1024 }, () => random.integer(size))).size).toBe(size);
//   });
//
//   it("拒绝篡改状态、轮转表和超额访问计数", () => {
//     const key = "26/23/any/any", { state } = nextPlannerStrategy(123, key);
//     for (const invalid of [{ ...state, state: 0 }, { ...state, reductions: [0, 1] },
//       { ...state, restarts: [1, 1, 1] }, { ...state, topologies: [9, 0] }]) {
//       expect(() => assertPlannerStrategyStates({ [key]: invalid }, 1)).toThrow();
//     }
//     expect(() => assertPlannerStrategyStates({ [key]: state }, 0)).toThrow("超过");
//   });
//
//   it("超过 32 位的产物组合仍能随机探索，并保持指定存货口数量", () => {
//     const random = new PlannerRandom(19), limit = 1n << 60n;
//     const ranks = Array.from({ length: 32 }, () => random.bigint(limit));
//     expect(ranks.every(rank => rank >= 0 && rank < limit)).toBe(true);
//     expect(ranks.some(rank => rank > 0xffffffffn)).toBe(true);
//     const profile = { pickupLength: 0, fixedStorageCount: 0, storageLength: 1,
//       automatic: Array.from({ length: 40 }, (_, index) => ({ itemId: `product-${index}`, count: 1 })) };
//     const request = structuredClone(input.request) as BlueprintPlannerRequest;
//     const combinations = Array.from({ length: 32 }, () => warehouseCountRequest(request, profile, 20, random));
//     for (const combination of combinations) expect(combination.options.itemPolicies!.filter(policy => policy.output === "warehouse")).toHaveLength(20);
//     expect(combinations.some(combination => combination.options.itemPolicies!.find(policy => policy.itemId === "product-0")!.output === "warehouse")).toBe(true);
//     expect(combinations.some(combination => combination.options.itemPolicies!.find(policy => policy.itemId === "product-0")!.output === "stash")).toBe(true);
//   });
//
//   it("共用步进器不改变 CPU / GPU 约定的无符号状态转换", () => {
//     const random = new PlannerRandom(0xffffffff);
//     expect(plannerRandomStep(0xffffffff)).toBe(253983);
//     expect(random.next()).toBe(253983);
//     expect(random.state).toBeGreaterThan(0);
//     expect(random.state).toBeLessThanOrEqual(0xffffffff);
//   });
// });
//
