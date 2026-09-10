// AI-REMOVED 2026-09-09:
// Reason: 按仿真引擎与状态所有权重组，原实现迁入明确的职责模块。
// Trigger: 用户授权抽离 dense / legacy 公共接口并重组 legacy。
// Evidence: 原入口混合引擎选择、查询、Worker bridge 与 legacy 控制状态。
// Replacement: src/simulation/legacy/metered-consumption.ts
// Risk: 异步生命周期与查询语义由双引擎回归验证。
// Human Review: Required
//
// Original code:
// // AI-REMOVED 2026-07-23:
// // Reason: 整个销毁型计量旁路被真实容量 5 槽位和五路 reserved-item 配方取代。
// // Trigger: 用户要求去掉现有计数器机制，物品到达十秒后才消耗，且消耗不受供电影响。
// // Evidence:
// //   - Stage 3 现在始终把物品写入目标槽；
// //   - consumption-channel 通过普通 reservations 在配方完成时扣料；
// //   - 设备许可从频道运行状态直接派生。
// // Replacement:
// //   - runtime-slot-access.ts 的通用槽位事务；
// //   - stage-1-advance-devices.ts / stage-5-settle-recipes.ts 的频道类型语义。
// // Risk: High - 所有旧调用方、快照和迁移字段必须同步移除。
// // Human Review: Required
// //
// // Original code:
// // export function isMeteredConsumptionInputPort(...) { ... }
// // export function isDeviceElectricallyPowered(...) { ... }
// // export function isMeteredConsumptionAuthorized(...) { ... }
// // export function canAcceptMeteredConsumptionItem(...) { ... }
// // export function recordMeteredConsumptionItem(...) { ... }
//
