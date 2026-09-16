/** Map 的插入顺序表示最近使用顺序；当前可见项不可驱逐，预算不足时只回收离屏项。 */
export function retainRecentMapEntries<K, V>(
  entries: Map<K, V>, required: ReadonlySet<K>, budgetBytes: number,
  sizeOf: (value: V) => number, release: (value: V) => void,
): void {
  let bytes = 0;
  for (const value of entries.values()) bytes += sizeOf(value);
  for (const [key, value] of entries) {
    if (bytes <= budgetBytes) break;
    if (required.has(key)) continue;
    bytes -= sizeOf(value);
    release(value);
    entries.delete(key);
  }
}

export function touchMapEntry<K, V>(entries: Map<K, V>, key: K): V | undefined {
  const value = entries.get(key);
  if (value !== undefined) { entries.delete(key); entries.set(key, value); }
  return value;
}
