import type { GridRect } from "@/domain/shared/grid";
import { areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { PlannerRandom } from "./search-random";

export interface PowerSearchPosition {
  readonly rect: GridRect;
  readonly covered: readonly number[];
  readonly obstruction: number;
  readonly distance: number;
}

/** 2026-10-17：贪心失败后从空方案回溯；随机顺序保留低覆盖桩位的机会，不设置桩间距。 */
export async function searchPowerCover(positions: readonly PowerSearchPosition[], targetCount: number,
  seed: number, maximumEvaluations: number, onEvaluation: () => void): Promise<readonly PowerSearchPosition[] | null> {
  const random = new PlannerRandom(seed), masks = positions.map(position => position.covered.reduce((mask, index) => mask | 1n << BigInt(index), 0n));
  let evaluations = 0;
  const search = async (remaining: bigint, available: readonly number[]): Promise<number[] | null> => {
    if (remaining === 0n) return [];
    if (evaluations >= maximumEvaluations) return null;
    let choices: number[] | undefined;
    for (let target = 0; target < targetCount; target++) {
      const bit = 1n << BigInt(target);
      if (!(remaining & bit)) continue;
      const candidates = available.filter(index => masks[index]! & bit);
      if (!candidates.length) return null;
      if (!choices || candidates.length < choices.length) choices = candidates;
    }
    choices = random.shuffle(choices!);
    const score = (index: number) => positions[index]!.covered.filter(target => remaining & 1n << BigInt(target)).length
      / (1 + positions[index]!.obstruction);
    // 三分之一结点完全随机；其余优先覆盖更多设备，但失败会撤回前面的选择。
    if (random.integer(3) !== 0) choices.sort((a, b) => score(b) - score(a) || positions[a]!.distance - positions[b]!.distance);
    for (const index of choices) {
      if (evaluations >= maximumEvaluations) break;
      onEvaluation(); evaluations++;
      if (evaluations % 32 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const next = await search(remaining & ~masks[index]!, available.filter(other => other !== index
        && !areGridRectsIntersecting(positions[index]!.rect, positions[other]!.rect)));
      if (next) return [index, ...next];
    }
    return null;
  };
  const selected = await search((1n << BigInt(targetCount)) - 1n, positions.map((_, index) => index));
  return selected?.map(index => positions[index]!) ?? null;
}
