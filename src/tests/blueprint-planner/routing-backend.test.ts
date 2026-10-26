// @vitest-environment node
import { expect, it } from "vitest";
import { PlannerRoutingGrid, ROUTE_BLOCKED, ROUTE_OCCUPIED, ROUTE_OPEN, ROUTE_RESERVED } from "@/blueprint-planner/routing-grid";
import { PlannerRoutingPerformance } from "@/blueprint-planner/routing-backend";
import { PlannerGpuRouting } from "@/blueprint-planner/gpu-routing";
import { PlannerRouter } from "@/blueprint-planner/router";
import { createRegistryContract } from "@/registry";
import type { PlannerPort } from "@/blueprint-planner/geometry";

it("数值镜像保持障碍、预留和交叉的增量变更，并隔离不同布局", () => {
  const grid = new PlannerRoutingGrid(), cell = grid.cell(-1, 2);
  grid.block(cell, 2);
  const bounds = { x: -2, y: 1, width: 4, height: 3 }, snapshot = grid.dense(bounds), offset = 10;
  expect(snapshot.values[offset]! & ROUTE_BLOCKED).not.toBe(0);
  expect(snapshot.values[offset + 1]! & ROUTE_BLOCKED).toBe(0);
  snapshot.firstDirty = snapshot.values.length; snapshot.lastDirty = 0;
  // AI-CORRECTION 2026-10-26：恢复 beta1 按物流种类预留的接口；增量镜像与隔离断言保持。
  // AI-CORRECTION 2026-10-26：轴预留属于保留的物理规则修复，继续验证原三参数接口。
  grid.reserve(cell, 1, 0); grid.updateRoute(cell, 0, 10, (1 << 5) | (1 << 15));
  expect(grid.dense(bounds)).toBe(snapshot);
  expect([snapshot.firstDirty, snapshot.lastDirty]).toEqual([offset, offset + 2]);
  expect(snapshot.values[offset]! & ROUTE_OCCUPIED).not.toBe(0);
  expect(snapshot.values[offset + 1]! & ROUTE_RESERVED).not.toBe(0);
  expect(snapshot.values[offset]! & 0xffff).toBe((1 << 5) | (1 << 15));
  const other = new PlannerRoutingGrid().dense(bounds);
  expect(other.values[offset]).toBe(ROUTE_OPEN);
  expect(grid.dense({ ...bounds, width: 5 }).values[12]! & ROUTE_OCCUPIED).not.toBe(0);
});

it("GPU 分派以包含数据往返的同题耗时为依据，无收益时冷却后重试，大图独立探测", () => {
  const policy = new PlannerRoutingPerformance();
  for (let i = 0; i < 3; i++) {
    expect(policy.choose(100, i)).toBe("compare");
    policy.record(100, 1, 4, i);
  }
  expect(policy.choose(100, 10)).toBe("cpu");
  expect(policy.choose(100, 30_003)).toBe("compare");
  expect(policy.choose(1000, 10)).toBe("compare");
  for (let i = 0; i < 3; i++) policy.record(1000, 20, 2, i);
  expect(policy.choose(1000, 10)).toBe("gpu");
  for (let i = 0; i < 31; i++) policy.choose(1000, 10);
  expect(policy.choose(100, 20)).toBe("cpu");
});

it("没有 WebGPU 时执行完整 CPU 布线；取消不会因回退而被吞掉", async () => {
  const source: PlannerPort = { entityId: "a", groupIndex: 0, portIndex: 0, direction: "output", kind: "belt",
    cell: { x: 0, y: 2 }, outside: { x: 1, y: 2 }, edge: "EAST" };
  const target: PlannerPort = { ...source, entityId: "b", direction: "input", cell: { x: 7, y: 2 }, outside: { x: 6, y: 2 }, edge: "WEST" };
  const backend = new PlannerGpuRouting();
  const router = new PlannerRouter(createRegistryContract(), [], [source, target], {
    minimumX: 0, minimumY: 0, maximumX: 7, maximumY: 5, escapeLength: 0,
  }, backend);
  await expect(router.connect(source, target, () => { throw new DOMException("暂停", "AbortError"); })).rejects.toMatchObject({ name: "AbortError" });
  expect(router.routes).toHaveLength(0);
  expect(await router.connect(source, target, () => {})).toBe(6);
  expect(router.routes[0]!.cells).toHaveLength(6);
  expect(backend.metrics.gpuAttempts).toBe(0);
  expect(backend.metrics.fallbackReason).toBeDefined();
});

// AI-REMOVED 2026-10-26:
// Reason: 预留轴参数随旧 Router 回退撤下；障碍、预留、增量更新与 CPU 回退仍完整验证。
// Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// Evidence: src/tests/blueprint-planner/routing-backend.test.ts；原文件 SHA256 9f6a8c1beffd3ac62aa380b62a2d01075f95d3616756e044c125cf3c3795af9f。
// Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// Human Review: Required
// Original code:
// // @vitest-environment node
// import { expect, it } from "vitest";
// import { PlannerRoutingGrid, ROUTE_BLOCKED, ROUTE_OCCUPIED, ROUTE_OPEN, ROUTE_RESERVED } from "@/blueprint-planner/routing-grid";
// import { PlannerRoutingPerformance } from "@/blueprint-planner/routing-backend";
// import { PlannerGpuRouting } from "@/blueprint-planner/gpu-routing";
// import { PlannerRouter } from "@/blueprint-planner/router";
// import { createRegistryContract } from "@/registry";
// import type { PlannerPort } from "@/blueprint-planner/geometry";
//
// it("数值镜像保持障碍、预留和交叉的增量变更，并隔离不同布局", () => {
//   const grid = new PlannerRoutingGrid(), cell = grid.cell(-1, 2);
//   grid.block(cell, 2);
//   const bounds = { x: -2, y: 1, width: 4, height: 3 }, snapshot = grid.dense(bounds), offset = 10;
//   expect(snapshot.values[offset]! & ROUTE_BLOCKED).not.toBe(0);
//   expect(snapshot.values[offset + 1]! & ROUTE_BLOCKED).toBe(0);
//   snapshot.firstDirty = snapshot.values.length; snapshot.lastDirty = 0;
//   grid.reserve(cell, 1, 0); grid.updateRoute(cell, 0, 10, (1 << 5) | (1 << 15));
//   expect(grid.dense(bounds)).toBe(snapshot);
//   expect([snapshot.firstDirty, snapshot.lastDirty]).toEqual([offset, offset + 2]);
//   expect(snapshot.values[offset]! & ROUTE_OCCUPIED).not.toBe(0);
//   expect(snapshot.values[offset + 1]! & ROUTE_RESERVED).not.toBe(0);
//   expect(snapshot.values[offset]! & 0xffff).toBe((1 << 5) | (1 << 15));
//   const other = new PlannerRoutingGrid().dense(bounds);
//   expect(other.values[offset]).toBe(ROUTE_OPEN);
//   expect(grid.dense({ ...bounds, width: 5 }).values[12]! & ROUTE_OCCUPIED).not.toBe(0);
// });
//
// it("GPU 分派以包含数据往返的同题耗时为依据，无收益时冷却后重试，大图独立探测", () => {
//   const policy = new PlannerRoutingPerformance();
//   for (let i = 0; i < 3; i++) {
//     expect(policy.choose(100, i)).toBe("compare");
//     policy.record(100, 1, 4, i);
//   }
//   expect(policy.choose(100, 10)).toBe("cpu");
//   expect(policy.choose(100, 30_003)).toBe("compare");
//   expect(policy.choose(1000, 10)).toBe("compare");
//   for (let i = 0; i < 3; i++) policy.record(1000, 20, 2, i);
//   expect(policy.choose(1000, 10)).toBe("gpu");
//   for (let i = 0; i < 31; i++) policy.choose(1000, 10);
//   expect(policy.choose(100, 20)).toBe("cpu");
// });
//
// it("没有 WebGPU 时执行完整 CPU 布线；取消不会因回退而被吞掉", async () => {
//   const source: PlannerPort = { entityId: "a", groupIndex: 0, portIndex: 0, direction: "output", kind: "belt",
//     cell: { x: 0, y: 2 }, outside: { x: 1, y: 2 }, edge: "EAST" };
//   const target: PlannerPort = { ...source, entityId: "b", direction: "input", cell: { x: 7, y: 2 }, outside: { x: 6, y: 2 }, edge: "WEST" };
//   const backend = new PlannerGpuRouting();
//   const router = new PlannerRouter(createRegistryContract(), [], [source, target], {
//     minimumX: 0, minimumY: 0, maximumX: 7, maximumY: 5, escapeLength: 0,
//   }, backend);
//   await expect(router.connect(source, target, () => { throw new DOMException("暂停", "AbortError"); })).rejects.toMatchObject({ name: "AbortError" });
//   expect(router.routes).toHaveLength(0);
//   expect(await router.connect(source, target, () => {})).toBe(6);
//   expect(router.routes[0]!.cells).toHaveLength(6);
//   expect(backend.metrics.gpuAttempts).toBe(0);
//   expect(backend.metrics.fallbackReason).toBeDefined();
// });
//
