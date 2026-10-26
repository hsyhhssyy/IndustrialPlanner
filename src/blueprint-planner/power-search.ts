
// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 c90e9a12d997944e39bec2bb00cdfeed2b34950b90bc15667a647e9d1eb29f7d。
// Replacement: None；功能随 beta1/2 搜索内核回退撤下
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/power-search.ts):
// import type { GridRect } from "@/domain/shared/grid";
// import { areGridRectsIntersecting } from "@/shared/geometry/power-range";
// import { PlannerRandom } from "./search-random";
//
// export interface PowerSearchPosition {
//   readonly rect: GridRect;
//   readonly covered: readonly number[];
//   readonly obstruction: number;
//   readonly distance: number;
// }
//
// /** 2026-10-17：贪心失败后从空方案回溯；随机顺序保留低覆盖桩位的机会，不设置桩间距。 */
// // 2026-10-21：完整覆盖可以继续接受调用方必要条件检查；拒绝后回溯，全部分支仍共用原硬预算。
// export async function searchPowerCover(positions: readonly PowerSearchPosition[], targetCount: number,
//   seed: number, maximumEvaluations: number, onEvaluation: () => void, accept?: (positions: readonly PowerSearchPosition[]) => boolean): Promise<readonly PowerSearchPosition[] | null> {
//   const random = new PlannerRandom(seed), masks = positions.map(position => position.covered.reduce((mask, index) => mask | 1n << BigInt(index), 0n));
//   let evaluations = 0;
//   const search = async (remaining: bigint, available: readonly number[], selected: readonly number[] = []): Promise<number[] | null> => {
//     if (remaining === 0n) return !accept || accept(selected.map(index => positions[index]!)) ? [] : null;
//     if (evaluations >= maximumEvaluations) return null;
//     let choices: number[] | undefined;
//     for (let target = 0; target < targetCount; target++) {
//       const bit = 1n << BigInt(target);
//       if (!(remaining & bit)) continue;
//       const candidates = available.filter(index => masks[index]! & bit);
//       if (!candidates.length) return null;
//       if (!choices || candidates.length < choices.length) choices = candidates;
//     }
//     choices = random.shuffle(choices!);
//     const score = (index: number) => positions[index]!.covered.filter(target => remaining & 1n << BigInt(target)).length
//       / (1 + positions[index]!.obstruction);
//     // 三分之一结点完全随机；其余优先覆盖更多设备，但失败会撤回前面的选择。
//     if (random.integer(3) !== 0) choices.sort((a, b) => score(b) - score(a) || positions[a]!.distance - positions[b]!.distance);
//     for (const index of choices) {
//       if (evaluations >= maximumEvaluations) break;
//       onEvaluation(); evaluations++;
//       if (evaluations % 32 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
//       const next = await search(remaining & ~masks[index]!, available.filter(other => other !== index
//         && !areGridRectsIntersecting(positions[index]!.rect, positions[other]!.rect)), [...selected, index]);
//       if (next) return [index, ...next];
//     }
//     return null;
//   };
//   const selected = await search((1n << BigInt(targetCount)) - 1n, positions.map((_, index) => index));
//   return selected?.map(index => positions[index]!) ?? null;
// }
//
