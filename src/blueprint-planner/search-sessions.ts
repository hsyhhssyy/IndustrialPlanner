import type { CompactLayoutSearch } from "./compact-layout";
import type { PartitionLayoutSearch } from "./partition-layout";
import type { PlannerNetwork, PlannerWire } from "./model";
import type { PlannerSearchSeed } from "./search-seed";

export interface PlannerSearchSession {
  readonly fingerprint: string;
  readonly network: PlannerNetwork;
  readonly wires: PlannerWire[];
  readonly search: CompactLayoutSearch | PartitionLayoutSearch;
  /** 产线构网后的约束及路由反馈随链保留；原图入口无需这部分准备状态。 */
  readonly production?: {
    readonly variant: number;
    readonly circulationLimits: Array<{ edges: number[]; inventory: number; processing: number }>;
    reusableRoutes: PlannerSearchSeed["routes"];
  };
}

/** Worker 所有的有界会话：保留退火链、随机数、路由惩罚和重建游标，不写入任务文件。 */
export class PlannerSearchSessions {
  private readonly layouts = new Map<string, PlannerSearchSession>();
  private invalidScope = "";
  private readonly invalidReductions = new Map<string, string>();

  /** 中断时只读取当前请求拥有的会话，序列化具体设备与拓扑供检查点恢复。 */
  snapshot(key: string | undefined): PlannerSearchSession | undefined { return key ? this.layouts.get(key) : undefined; }

  get(key: string | undefined, fingerprint: string): PlannerSearchSession | undefined {
    if (!key) return undefined;
    const session = this.layouts.get(key);
    if (session?.fingerprint !== fingerprint) { this.layouts.delete(key); return undefined; }
    this.layouts.delete(key); this.layouts.set(key, session);
    return session;
  }
  set(key: string | undefined, session: PlannerSearchSession): void {
    if (!key) return;
    this.layouts.delete(key); this.layouts.set(key, session);
    while (this.layouts.size > 4) this.layouts.delete(this.layouts.keys().next().value!);
  }
  delete(key: string | undefined): void { if (key) this.layouts.delete(key); }
  reduction(scope: string, key: string, reason?: string): string | undefined {
    if (scope !== this.invalidScope) { this.invalidScope = scope; this.invalidReductions.clear(); }
    if (reason) {
      this.invalidReductions.set(key, reason);
      while (this.invalidReductions.size > 256) this.invalidReductions.delete(this.invalidReductions.keys().next().value!);
    }
    return this.invalidReductions.get(key);
  }
}

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/blueprint-planner/search-sessions.ts 第 14 行：
//     readonly circulationLimits: Array<{ edges: number[]; weights: number[]; inventory: number; processing: number }>;
