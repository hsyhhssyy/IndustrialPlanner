// @vitest-environment node
/**
 * 供电回退：2026-10-17 07:44 +08:00，覆盖最多的首选可能同时阻断其他合法桩位。
 * 必须从空方案回溯；相邻但不重叠的桩合法，预算包含失败分支且异常向上传递。
 */
import { expect, it } from "vitest";
import { searchPowerCover } from "@/blueprint-planner/power-search";

it("放弃阻断两个必要桩位的高覆盖首选，允许两个桩直接相邻", async () => {
  const positions = [
    { rect: { x: 1, y: 0, width: 2, height: 2 }, covered: [0, 1, 2], obstruction: 0, distance: 0 },
    { rect: { x: 0, y: 0, width: 2, height: 2 }, covered: [0, 3], obstruction: 0, distance: 1 },
    { rect: { x: 2, y: 0, width: 2, height: 2 }, covered: [1, 2], obstruction: 0, distance: 1 },
    { rect: { x: 1, y: 1, width: 2, height: 2 }, covered: [3], obstruction: 0, distance: 2 },
  ];
  let evaluations = 0;
  const result = await searchPowerCover(positions, 4, 42, 32, () => evaluations++);
  expect(result).toEqual(expect.arrayContaining([positions[1], positions[2]]));
  expect(result).toHaveLength(2);
  expect(evaluations).toBeGreaterThan(2);
  expect(evaluations).toBeLessThanOrEqual(32);
});

it("回溯严格受同一预算限制，取消错误不会被伪装成无解", async () => {
  const positions = [
    { rect: { x: 0, y: 0, width: 2, height: 2 }, covered: [0], obstruction: 0, distance: 0 },
    { rect: { x: 2, y: 0, width: 2, height: 2 }, covered: [1], obstruction: 0, distance: 0 },
  ];
  let evaluations = 0;
  expect(await searchPowerCover(positions, 2, 42, 1, () => evaluations++)).toBeNull();
  expect(evaluations).toBe(1);
  await expect(searchPowerCover(positions, 2, 42, 32, () => { throw new Error("cancelled"); })).rejects.toThrow("cancelled");
});
