import type { SceneTimePolicy, SceneTimeSample } from "@/domain/shared/scene-time";

/** 仅解析调用方时间；不创建定时器、不读取墙钟、不推进仿真。 */
export class SceneClock {
  private policy: SceneTimePolicy;
  private previousSourceTimeMs: number | null = null;
  private effectiveTimeMs: number;

  public constructor(policy: SceneTimePolicy) {
    validatePolicy(policy);
    this.policy = { ...policy };
    this.effectiveTimeMs = policy.kind === "fixed" ? policy.sampleTimeMs : policy.initialTimeMs;
  }

  public get sampleTimeMs(): number {
    return this.effectiveTimeMs;
  }

  public setPolicy(policy: SceneTimePolicy): void {
    validatePolicy(policy);
    this.policy = { ...policy };
    this.effectiveTimeMs = policy.kind === "fixed" ? policy.sampleTimeMs : policy.initialTimeMs;
    this.resetBaseline();
  }

  /** 挂起恢复后首个样本只建立基准，隐藏时间不会补播。 */
  public resetBaseline(): void {
    this.previousSourceTimeMs = null;
  }

  /** 返回本次有效增量；重复样本、倒退样本、固定采样和无样本重绘均为 0。 */
  public update(sample?: SceneTimeSample): number {
    if (sample === undefined || this.policy.kind === "fixed") return 0;
    if (sample.clockId !== this.policy.clockId) throw new Error("Scene clock source mismatch");
    validateTime(sample.timeMs);
    if (this.previousSourceTimeMs === null) {
      this.previousSourceTimeMs = sample.timeMs;
      return 0;
    }
    if (sample.timeMs <= this.previousSourceTimeMs) return 0;
    const deltaMs = sample.timeMs - this.previousSourceTimeMs;
    const nextTimeMs = this.effectiveTimeMs + deltaMs;
    validateTime(nextTimeMs);
    this.previousSourceTimeMs = sample.timeMs;
    this.effectiveTimeMs = nextTimeMs;
    return deltaMs;
  }
}

function validatePolicy(policy: SceneTimePolicy): void {
  if (policy.kind === "advancing" && policy.clockId.length === 0) throw new Error("Scene clock id is required");
  validateTime(policy.kind === "fixed" ? policy.sampleTimeMs : policy.initialTimeMs);
}

function validateTime(timeMs: number): void {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error("Invalid scene sample time");
}
