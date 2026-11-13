const frozenGraphs = new WeakSet<object>();
const freezingGraphs = new WeakSet<object>();

/** 文档是普通数据；已发布分支只遍历一次，后续写入只冻结新增分支。 */
export function freezeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object" || frozenGraphs.has(value) || freezingGraphs.has(value)) return value;
  freezingGraphs.add(value);
  try {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
    frozenGraphs.add(value);
    return value;
  } finally {
    // getter 或冻结失败时不能把未完成对象标记为已发布，同时保留循环引用支持。
    freezingGraphs.delete(value);
  }
}
