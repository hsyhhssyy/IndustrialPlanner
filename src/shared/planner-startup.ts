/** 启动依赖按通道描述：同一需求的来源是 OR，多个需求之间是 AND。 */
export interface PlannerStartupOperation {
  readonly id: string;
  readonly requirements: readonly (readonly string[])[];
  readonly outputs: readonly string[];
}

/** 只证明结构上可能启动；流量、有限库存和运输时序仍由真实场景验收。 */
export function plannerStartupClosure(operations: readonly PlannerStartupOperation[], sources: Iterable<string>) {
  const available = new Set(sources), started = new Set<string>();
  const waiting = new Map<string, Set<number>>();
  const missing = operations.map(operation => operation.requirements.filter(group => !group.some(key => available.has(key))).length);
  const satisfied = operations.map(operation => operation.requirements.map(group => group.some(key => available.has(key))));
  operations.forEach((operation, index) => operation.requirements.forEach(group => group.forEach(key => {
    const entries = waiting.get(key) ?? new Set<number>();
    entries.add(index); waiting.set(key, entries);
  })));
  const ready = operations.flatMap((_, index) => missing[index] === 0 ? [index] : []);
  for (let at = 0; at < ready.length; at++) {
    const operation = operations[ready[at]!]!;
    if (started.has(operation.id)) continue;
    started.add(operation.id);
    for (const output of operation.outputs) {
      if (available.has(output)) continue;
      available.add(output);
      for (const index of waiting.get(output) ?? []) {
        operations[index]!.requirements.forEach((group, requirement) => {
          if (!satisfied[index]![requirement] && group.includes(output)) {
            satisfied[index]![requirement] = true; missing[index]!--;
          }
        });
        if (missing[index] === 0) ready.push(index);
      }
    }
  }
  return { available, started };
}
