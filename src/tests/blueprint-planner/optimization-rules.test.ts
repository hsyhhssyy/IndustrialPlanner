// @vitest-environment node

import { expect, it } from "vitest";
import { partitionEqualFlows } from "@/blueprint-planner/equal-flow";
import { boundedPlannerScore } from "@/blueprint-planner/quality";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import { compactSequencePair } from "@/blueprint-planner/sequence-pair";

it("四个等量消费者生成二叉均分，不生成 1/2、1/4、1/4 的假均分", () => {
  const groups = partitionEqualFlows([6, 6, 6, 6], value => value, 3);
  expect(groups.map(group => group.reduce((sum, value) => sum + value, 0))).toEqual([12, 12]);
  expect(groups.flat()).toEqual([6, 6, 6, 6]);
});

it("三个等量消费者直接三分，异量消费者保留真实总量", () => {
  expect(partitionEqualFlows([6, 6, 6], value => value, 3)).toEqual([[6], [6], [6]]);
  const groups = partitionEqualFlows([30, 30, 6, 6, 6, 6], value => value, 3);
  expect(groups.flat().sort((a, b) => a - b)).toEqual([6, 6, 6, 6, 30, 30]);
});

it("再差的辅助分也不能使小一格面积落败", () => {
  expect(boundedPlannerScore(749, Number.MAX_VALUE)).toBeLessThan(boundedPlannerScore(750, -Number.MAX_VALUE));
  expect(boundedPlannerScore(750, 100)).toBeLessThan(boundedPlannerScore(750, 101));
});

it("外部参数不能加入评分权重或以 NaN 绕过搜索边界", () => {
  expect(() => resolveSearchProfile({ initialTemperature: NaN })).toThrow();
  expect(() => resolveSearchProfile({ initialClearance: 0.5 })).toThrow();
  expect(() => resolveSearchProfile(JSON.parse('{"qualityWeight":0}'))).toThrow();
});

it("Sequence Pair 同序水平压紧，反序垂直压紧，混合次序也不会重叠", () => {
  const blocks = [{ width: 5, height: 3 }, { width: 3, height: 5 }, { width: 1, height: 1 }];
  expect(compactSequencePair(blocks, [0, 1, 2], [0, 1, 2], 1)).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 10, y: 0 }]);
  expect(compactSequencePair(blocks, [0, 1, 2], [2, 1, 0], 1)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 0, y: 10 }]);
  const poses = compactSequencePair(blocks, [1, 0, 2], [2, 1, 0], 0);
  for (let i = 0; i < blocks.length; i++) for (let j = 0; j < i; j++) {
    const a = poses[i]!, b = poses[j]!, sa = blocks[i]!, sb = blocks[j]!;
    expect(a.x + sa.width <= b.x || b.x + sb.width <= a.x || a.y + sa.height <= b.y || b.y + sb.height <= a.y).toBe(true);
  }
});
