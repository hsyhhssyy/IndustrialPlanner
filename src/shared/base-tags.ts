const MAX_PIPE_LOGISTICS_TAG_PREFIX = "maxPipeLogistics=";

/**
 * 从基地 tags 中解析最大管道物流数。
 * AI-CORRECTION 2026-07-27: 此处的“管道物流”现称为“管道物流设备”，
 * 仅包括分流器、汇流器、桥接器和准入口，不包括管道节。
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
