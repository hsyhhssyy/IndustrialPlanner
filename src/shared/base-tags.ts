const MAX_PIPE_LOGISTICS_TAG_PREFIX = "maxPipeLogistics=";

/**
 * 从基地 tags 中解析最大管道物流数。
 * 未设置时返回 null。
 */
export function resolveBaseMaxPipeLogistics(tags: readonly string[]): number | null {
  const tag = tags.find((t) => t.startsWith(MAX_PIPE_LOGISTICS_TAG_PREFIX));
  if (tag === undefined) return null;

  const raw = tag.slice(MAX_PIPE_LOGISTICS_TAG_PREFIX.length);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;

  return value;
}
