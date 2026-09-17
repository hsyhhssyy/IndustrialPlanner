/** 优先构成等流量的二/三叉树；不把级联分流误当成任意比例分配。 */
export function partitionEqualFlows<T>(entries: readonly T[], rate: (entry: T) => number, maximumBranches: number): T[][] {
  const sorted = [...entries].sort((a, b) => rate(b) - rate(a));
  const total = sorted.reduce((sum, entry) => sum + rate(entry), 0);
  for (let count = Math.min(maximumBranches, entries.length); count >= 2; count--) {
    const target = total / count;
    if (sorted.some(entry => rate(entry) > target + 1e-6)) continue;
    const groups: T[][] = Array.from({ length: count }, () => []);
    const sums = Array<number>(count).fill(0);
    let remaining = 4096;
    const assign = (index: number): boolean => {
      if (--remaining < 0) return false;
      if (index === sorted.length) return sums.every(sum => Math.abs(sum - target) < 1e-6);
      const entry = sorted[index]!;
      const seen = new Set<number>();
      for (let branch = 0; branch < count; branch++) {
        if (seen.has(sums[branch]!) || sums[branch]! + rate(entry) > target + 1e-6) continue;
        seen.add(sums[branch]!);
        groups[branch]!.push(entry); sums[branch]! += rate(entry);
        if (assign(index + 1)) return true;
        groups[branch]!.pop(); sums[branch]! -= rate(entry);
      }
      return false;
    };
    if (assign(0)) return groups;
  }
  const groups: T[][] = Array.from({ length: Math.min(maximumBranches, entries.length) }, () => []);
  for (const entry of sorted) {
    const sums = groups.map(group => group.reduce((sum, item) => sum + rate(item), 0));
    groups[sums.indexOf(Math.min(...sums))]!.push(entry);
  }
  return groups;
}
