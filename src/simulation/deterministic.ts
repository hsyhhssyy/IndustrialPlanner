// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/topology/deterministic.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// export function stableStringify(value: unknown): string {
//   return JSON.stringify(toStableJsonValue(value));
// }
//
// export function hashStable(value: unknown): string {
//   const text = stableStringify(value);
//   let hash = 0x811c9dc5;
//
//   for (let index = 0; index < text.length; index += 1) {
//     hash ^= text.charCodeAt(index);
//     hash = Math.imul(hash, 0x01000193);
//   }
//
//   return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
// }
//
// function toStableJsonValue(value: unknown): unknown {
//   if (Array.isArray(value)) {
//     return value.map((entry) => toStableJsonValue(entry));
//   }
//
//   if (value === null || typeof value !== "object") {
//     return value;
//   }
//
//   const record = value as Record<string, unknown>;
//   const nextRecord: Record<string, unknown> = {};
//
//   for (const key of Object.keys(record).sort()) {
//     nextRecord[key] = toStableJsonValue(record[key]);
//   }
//
//   return nextRecord;
// }
//
