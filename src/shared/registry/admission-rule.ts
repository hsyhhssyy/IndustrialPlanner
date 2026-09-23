import type { EntityAdmissionRuleDefinition } from "@/domain/registry/types/entity-definition";

/**
 * 解析实体 config 或端口声明中的准入口规则。
 *
 * AI-CORRECTION 2026-09-23: 原实现是 src/app/shell/inspector/admission-rule-inspector.tsx 的私有函数。
 * 基地问题检查与 Inspector 需要同一份 perMinuteLimit 解析语义，故上提为 shared 单一真源。
 */
export function readAdmissionRule(value: unknown): EntityAdmissionRuleDefinition | null {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const itemId = typeof record.itemId === "string" && record.itemId.length > 0
    ? record.itemId
    : null;
  const limit = typeof record.limit === "number" && Number.isFinite(record.limit)
    ? Math.max(0, Math.floor(record.limit))
    : null;
  const perMinuteLimit = typeof record.perMinuteLimit === "number" && Number.isFinite(record.perMinuteLimit)
    ? Math.max(0, Math.floor(record.perMinuteLimit))
    : null;

  return { itemId, limit, perMinuteLimit };
}
