
// AI-REMOVED 2026-10-26:
// Reason: 测试仅覆盖 beta1/2 之后加入且本次撤下的局部修复、容量评分、子网或连接采样分支。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/power-cover-search.test.ts；原文件 SHA256 e4048bf7f2d3e4ada655a0fb331a96e146532f715cc358ea97833962aba33a2e。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// /**
//  * 供电回退：2026-10-17 07:44 +08:00，覆盖最多的首选可能同时阻断其他合法桩位。
//  * 必须从空方案回溯；相邻但不重叠的桩合法，预算包含失败分支且异常向上传递。
//  */
// import { expect, it } from "vitest";
// import { searchPowerCover, type PowerSearchPosition } from "@/blueprint-planner/power-search";
//
// it("放弃阻断两个必要桩位的高覆盖首选，允许两个桩直接相邻", async () => {
//   const positions = [
//     { rect: { x: 1, y: 0, width: 2, height: 2 }, covered: [0, 1, 2], obstruction: 0, distance: 0 },
//     { rect: { x: 0, y: 0, width: 2, height: 2 }, covered: [0, 3], obstruction: 0, distance: 1 },
//     { rect: { x: 2, y: 0, width: 2, height: 2 }, covered: [1, 2], obstruction: 0, distance: 1 },
//     { rect: { x: 1, y: 1, width: 2, height: 2 }, covered: [3], obstruction: 0, distance: 2 },
//   ];
//   let evaluations = 0;
//   const result = await searchPowerCover(positions, 4, 42, 32, () => evaluations++);
//   expect(result).toEqual(expect.arrayContaining([positions[1], positions[2]]));
//   expect(result).toHaveLength(2);
//   expect(evaluations).toBeGreaterThan(2);
//   expect(evaluations).toBeLessThanOrEqual(32);
// });
//
// it("回溯严格受同一预算限制，取消错误不会被伪装成无解", async () => {
//   const positions = [
//     { rect: { x: 0, y: 0, width: 2, height: 2 }, covered: [0], obstruction: 0, distance: 0 },
//     { rect: { x: 2, y: 0, width: 2, height: 2 }, covered: [1], obstruction: 0, distance: 0 },
//   ];
//   let evaluations = 0;
//   expect(await searchPowerCover(positions, 2, 42, 1, () => evaluations++)).toBeNull();
//   expect(evaluations).toBe(1);
//   await expect(searchPowerCover(positions, 2, 42, 32, () => { throw new Error("cancelled"); })).rejects.toThrow("cancelled");
// });
//
// // 2026-10-21：完整覆盖仍须满足调用方的通道条件，拒绝后继续回溯而不是直接返回无解。
// it("完整覆盖被通道条件拒绝后尝试其他覆盖，拒绝分支也计费", async () => {
//   const positions = [
//     { rect: { x: 0, y: 0, width: 2, height: 2 }, covered: [0], obstruction: 0, distance: 0 },
//     { rect: { x: 3, y: 0, width: 2, height: 2 }, covered: [0], obstruction: 0, distance: 1 },
//   ];
//   const inspected: Array<readonly PowerSearchPosition[]> = [];
//   let evaluations = 0;
//   const result = await searchPowerCover(positions, 1, 42, 2, () => evaluations++, selected => {
//     inspected.push(selected);
//     return inspected.length === 2;
//   });
//   expect(evaluations).toBe(2);
//   expect(inspected).toHaveLength(2);
//   expect(result).toEqual(inspected[1]);
//   expect(result).not.toEqual(inspected[0]);
// });
//
// it("完整覆盖条件不得绕过硬预算或吞掉取消错误", async () => {
//   const positions = [
//     { rect: { x: 0, y: 0, width: 2, height: 2 }, covered: [0], obstruction: 0, distance: 0 },
//     { rect: { x: 3, y: 0, width: 2, height: 2 }, covered: [0], obstruction: 0, distance: 1 },
//   ];
//   let evaluations = 0;
//   expect(await searchPowerCover(positions, 1, 42, 1, () => evaluations++, () => false)).toBeNull();
//   expect(evaluations).toBe(1);
//   await expect(searchPowerCover(positions, 1, 42, 2, () => {}, () => { throw new Error("cancelled"); }))
//     .rejects.toThrow("cancelled");
// });
//
