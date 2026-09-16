const frozenGraphs = new WeakSet<object>();

/** 文档是普通数据；已发布分支只遍历一次，后续写入只冻结新增分支。 */
export function freezeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object" || frozenGraphs.has(value)) return value;
  frozenGraphs.add(value);
  for (const child of Object.values(value)) freezeSnapshot(child);
  return Object.freeze(value);
}
