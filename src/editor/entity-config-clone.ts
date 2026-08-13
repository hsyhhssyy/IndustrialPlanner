/**
 * 深拷贝实体 config，并净化其中可能被 MobX observable 化的对象。
 *
 * AI-CORRECTION 2026-08-13: 实体 draft 经 `state.drafts`（MobX deep observable）持有后，
 * 与文档快照共享引用的 config 嵌套对象会被原位 observable 化；此前多处
 * `{ ...entity.config }` 浅拷贝会把 observable 对象写回快照或继续共享引用，
 * 导致世界文档同步时 structuredClone 失败（"#<Object> could not be cloned"）。
 * 本函数只遍历可枚举字符串键，MobX 的 administration（Symbol 键）不会进入拷贝结果。
 */
export function cloneEntityConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const cloneValue = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(cloneValue);
    }
    if (node !== null && typeof node === "object") {
      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        next[key] = cloneValue(child);
      }
      return next;
    }
    return node;
  };

  return cloneValue(config) as Record<string, unknown>;
}
