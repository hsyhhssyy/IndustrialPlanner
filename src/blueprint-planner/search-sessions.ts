import type { CompactLayoutSearch } from "./compact-layout";
import type { PlannerNetwork, PlannerWire } from "./model";
import type { PlannerSearchSeed } from "./search-seed";

export interface PlannerSearchSession {
  readonly fingerprint: string;
  readonly network: PlannerNetwork;
  readonly wires: PlannerWire[];
  readonly search: CompactLayoutSearch;
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
