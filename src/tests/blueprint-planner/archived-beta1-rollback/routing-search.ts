
// AI-REMOVED 2026-10-26:
// Reason: 本用例专测 beta1/2 后加入的有界寻路堆；已恢复旧分页堆，Router 及 CPU/GPU 布线回归继续保留。
// Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// Evidence: src/tests/blueprint-planner/routing-search.test.ts；原文件 SHA256 50e279362b11927d0d7d24a1486fdb77c82a0a93b35965de4bcc3cb0e5aff68e。
// Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// Human Review: Required
// Original code:
// // @vitest-environment node
// // 2026-10-23：有界容量寻路复用同一堆，评分、过期项及同分弹出次序必须与原分页工作区一致。
// import { expect, it } from "vitest";
// import { PlannerRoutingSearch } from "@/blueprint-planner/routing-search";
//
// it("有界与分页寻路在扩容、重复改善、同价及多次重置后保持逐项一致", () => {
//   const sparse = new PlannerRoutingSearch(), bounded = new PlannerRoutingSearch(513);
//   let random = 1234567;
//   for (let round = 0; round < 3; round++) {
//     sparse.reset(0); bounded.reset(0);
//     for (let at = 0; at < 10000; at++) {
//       random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
//       const cell = random % 513, direction = (random >>> 12) % 4, cost = (random >>> 8) % 200;
//       for (const queue of [sparse, bounded]) queue.push(cell, direction, at % 7, cost, Math.floor(cost / 3), at - 1);
//     }
//     while (sparse.size) {
//       expect(bounded.size).toBe(sparse.size);
//       const left = sparse.pop(), right = bounded.pop();
//       expect(right).toBe(left);
//       expect(bounded.stale(right)).toBe(sparse.stale(left));
//       for (const key of ["cells", "directions", "steps", "parents", "costs"] as const) expect(bounded[key][right]).toBe(sparse[key][left]);
//     }
//     expect(bounded.size).toBe(0);
//   }
// });
//
// it("有界模式拒绝无效容量、越界状态及最短长度分层，分页模式保留原分层能力", () => {
//   expect(() => new PlannerRoutingSearch(0)).toThrow("格数");
//   const queue = new PlannerRoutingSearch(1);
//   expect(() => queue.reset(1)).toThrow("最短长度");
//   expect(() => queue.push(1, 0, 0, 1, 1, -1)).toThrow("超出");
//   const sparse = new PlannerRoutingSearch(); sparse.reset(2);
//   sparse.push(0, 0, 0, 1, 1, -1); sparse.push(0, 0, 1, 2, 2, -1);
//   expect(sparse.size).toBe(2);
// });
//
