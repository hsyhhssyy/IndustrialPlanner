// @vitest-environment node
import { expect, it } from "vitest";
import { buildSyntheticProblem, scaleToShape, searchCpu } from "@/blueprint-planner/gpu-crossover";
import { ROUTE_BLOCKED } from "@/blueprint-planner/routing-grid";

/**
 * 2026-10-06：这组用例锁住合成栅格与 CPU 对照的契约。
 * 这里踩过两次坑：出口掩码与入口许可位必须同时写；通道外不能留 0（那表示"存在但不可进入"）。
 * 这两类错误的表现都是"静默解不出线路"，没有断言就会悄悄退化。
 */
it("合成栅格是可解的，且起终点在中间行", () => {
  for (const cells of [64, 256, 1_024]) {
    const { width, height } = scaleToShape(cells);
    const problem = buildSyntheticProblem(width, height);
    expect(problem.start.y).toBe(Math.floor(height / 2));
    expect(problem.goal.y).toBe(problem.start.y);
    expect(problem.start.x).toBe(0);
    expect(problem.goal.x).toBe(width - 1);
    expect(searchCpu(problem)).not.toBeNull();
  }
});

it("同一规模每次生成同一张图，测量可复现", () => {
  const first = buildSyntheticProblem(24, 24), second = buildSyntheticProblem(24, 24);
  for (let x = 0; x < 24; x++) {
    for (let y = 0; y < 24; y++) {
      expect(first.grid.read(first.grid.cell(x, y), 0)).toBe(second.grid.read(second.grid.cell(x, y), 0));
    }
  }
});

it("起终点连通行保持畅通，封锁只落在别处", () => {
  const { width, height } = scaleToShape(1_024);
  const problem = buildSyntheticProblem(width, height);
  const row = Math.floor(height / 2);
  for (let x = 0; x < width; x++) {
    expect(problem.grid.read(problem.grid.cell(x, row), 0) & ROUTE_BLOCKED).toBe(0);
  }
});

it("起点以 EAST 为初始进入状态，终点要求以 WEST 收尾", () => {
  const problem = buildSyntheticProblem(16, 16);
  // 出口掩码位 = incoming * 4 + outgoing：起点需要 EAST->EAST（位 5），终点需要 EAST->WEST（位 7）。
  const startWord = problem.grid.read(problem.grid.cell(problem.start.x, problem.start.y), 0);
  const goalWord = problem.grid.read(problem.grid.cell(problem.goal.x, problem.goal.y), 0);
  expect(startWord & (1 << (problem.startDirection * 4 + problem.startDirection))).not.toBe(0);
  expect(goalWord & (1 << (problem.startDirection * 4 + problem.finalDirection))).not.toBe(0);
});

it("形状函数给出接近目标格数、长宽比不极端的矩形", () => {
  for (const cells of [256, 4_096, 65_536]) {
    const { width, height } = scaleToShape(cells);
    expect(width * height).toBeGreaterThanOrEqual(cells);
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(4);
  }
});
