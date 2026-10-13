import type { RegistryContract } from "@/domain/registry/registry-contract";
import { cloneCompactPlannerTask } from "@/shared/planner-task-memory";

export function clonePlannerTask<T>(value: T, registry: RegistryContract): T {
  return cloneCompactPlannerTask(value, registry.itemDefinitions.map(item => item.id));
}

// AI-REMOVED 2026-10-13:
// Reason: 文件解析 Worker 与规划器恢复需共用归一化，避免两套格式规则。
// Trigger: 原始 81MB JSON 导入峰值超过内存目标。
// Evidence: round-08/10/11 导入后最高峰；现有依赖无任务文件解析 Worker。
// Replacement: shared/planner-task-memory.ts（Extend 既有实现）
// Risk: 共享规则必须保留原图和非法输入；Human Review: Required
// Original code:
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// 
// /** JSON 边界只归一化完整关闭规则和相同种子；不改输入、搜索计数或候选排序。 */
// export function clonePlannerTask<T>(value: T, registry: RegistryContract): T {
//   const items = new Set(registry.itemDefinitions.map(item => item.id));
//   const seeds = new Map<string, unknown>();
//   const visited = new WeakMap<object, unknown>();
//   const request = (value as { request?: { blueprintSource?: unknown; kind?: unknown } } | null)?.request;
//   // 原图的配置属于保真约束与请求指纹；只归一化规划器生成的规则。
//   const generated = !request?.blueprintSource && request?.kind !== "blueprint-recognition";
//   const normalize = (value: unknown, key: string, depth: number): unknown => {
//     if (!value || typeof value !== "object") return value;
//     if (depth > 100) throw new Error("任务数据嵌套过深。");
//     if (visited.has(value)) return visited.get(value);
//     if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return value;
//     const record = value as Record<string, unknown>;
//     if (generated && /^portGroups\[\d+\]\.ports\[\d+\]\.acceptRule$/.test(key)
//       && record.base && typeof record.base === "object" && (record.base as { kind?: unknown }).kind === "domain"
//       && Array.isArray(record.exclude) && record.exclude.length === items.size
//       && new Set(record.exclude).size === items.size && record.exclude.every(id => typeof id === "string" && items.has(id))) {
//       const rule = { ...record, base: { kind: "none" }, exclude: [] };
//       visited.set(value, rule);
//       return rule;
//     }
//     const result: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
//     visited.set(value, result);
//     let changed = false;
//     for (const [name, entry] of Object.entries(value)) {
//       const next = normalize(entry, name, depth + 1);
//       Object.defineProperty(result, name, { value: next, enumerable: true, configurable: true, writable: true });
//       changed ||= next !== entry;
//     }
//     let normalized: unknown = changed ? result : value;
//     if (key === "seed" && typeof record.requestKey === "string" && record.network && Array.isArray(record.wires)) {
//       // 只在导入／恢复边界比较内容；运行中由不可变种子引用维持共享，不反复计算内容键。
//       const signature = JSON.stringify(normalized);
//       if (seeds.has(signature)) normalized = seeds.get(signature);
//       else seeds.set(signature, normalized);
//     }
//     visited.set(value, normalized);
//     return normalized;
//   };
//   return structuredClone(normalize(value, "", 0)) as T;
// }
