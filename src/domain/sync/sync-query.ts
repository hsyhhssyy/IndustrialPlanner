/**
 * 预留给不适合表达为可观察状态的同步查询。
 */
// AI-CORRECTION 2026-07-29: 使用可选 never 品牌保持空 query 契约，同时避免空接口接受原始值。
export interface SyncQuery {
  readonly _syncQueryBrand?: never;
}
