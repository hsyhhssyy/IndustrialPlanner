/** 与 CPU / WGSL 布局内核共用 xorshift32；状态必须非零。 */
export function plannerRandomStep(state: number): number {
  let value = state;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return value >>> 0;
}

/** 将任务身份及随机流名称混合到 32 位；不把连续编号的低位直接当作策略。 */
export function plannerRandomSeed(identity: string): number {
  let value = 2166136261;
  for (const char of identity) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35);
  return (value ^ value >>> 16) >>> 0 || 1;
}

export function assertPlannerRandomState(state: number): void {
  if (!Number.isInteger(state) || state <= 0 || state > 0xffffffff) throw new Error("搜索随机状态无效。");
}

export class PlannerRandom {
  constructor(public state: number) { assertPlannerRandomState(state); }

  next(): number { return this.state = plannerRandomStep(this.state); }

  /** 非零 xorshift 的输出域有 2^32-1 个值；拒绝尾部余数，避免取模偏差。 */
  integer(count: number): number {
    if (!Number.isSafeInteger(count) || count < 1 || count > 0xffffffff) throw new Error("随机选择范围无效。");
    const limit = 0xffffffff - 0xffffffff % count;
    let value: number;
    do { value = this.next() - 1; } while (value >= limit);
    return value % count;
  }

  /** 同口数的产物组合可能超过 32 位；按实际位数拒绝采样，不截断可选组合。 */
  bigint(count: bigint): bigint {
    if (count < 1n) throw new Error("随机组合范围无效。");
    if (count === 1n) return 0n;
    const bits = (count - 1n).toString(2).length;
    let value: bigint;
    do {
      value = 0n;
      for (let offset = 0; offset < bits; offset += 16) {
        const width = Math.min(16, bits - offset);
        value = value << BigInt(width) | BigInt(this.integer(2 ** width));
      }
    } while (value >= count);
    return value;
  }

  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
      const other = this.integer(index + 1);
      [result[index], result[other]] = [result[other]!, result[index]!];
    }
    return result;
  }
}
