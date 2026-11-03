// AI-REMOVED 2026-11-02:
// Reason: Dense 与 Legacy 共用概率选择及随机能力，移除 Dense 私有副本。
// Trigger: ST2-RQ-046 Legacy 支持。
// Evidence: 两种引擎适用同一候选选择规则和固定种子算法。
// Replacement: src/simulation/recipe-selection/index.ts
// Risk: Low；随机状态仍由运行会话持有，不进入检查点。
// Human Review: Required
// Original code:
// /** 一次逻辑仿真共享的随机源，独立于 checkpoint；每次实际选择只调用一次。 */
// export interface DenseRecipeRandomSource {
//   next(): number;
// }
// 
// /** 固定非零种子的 xorshift32；新运行才创建，重算与拓扑迁移复用原实例。 */
// export class DenseRecipeRandom implements DenseRecipeRandomSource {
//   private state = 0x6d2b79f5;
// 
//   public next(): number {
//     let value = this.state;
//     value ^= value << 13;
//     value ^= value >>> 17;
//     value ^= value << 5;
//     this.state = value >>> 0;
//     return (this.state - 1) / 0xffffffff;
//   }
// }
