import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import {
  normalizeDeviceSpriteAnimationDefinition,
  type DeviceSpriteAnimationPhase,
  type NormalizedDeviceSpriteAnimationDefinition,
} from "@/shared/device-sprite-animation";

/** 每个可见设备独立保存播放进度；目标反转只在完整 idle 轮次结束后提交。 */
export class DeviceAnimationState {
  private readonly definition: NormalizedDeviceSpriteAnimationDefinition;
  private currentStage: DeviceSpriteAnimationPhase = "close_idle";
  private stageElapsedMs = 0;
  private desiredWorking = false;
  private holdingCloseIdle = false;

  public constructor(
    definition: DeviceSpriteAnimationDefinition,
    desiredWorking: boolean,
    stable = false,
  ) {
    this.definition = normalizeDeviceSpriteAnimationDefinition(definition);
    this.reset(desiredWorking, stable);
  }

  public get stage(): DeviceSpriteAnimationPhase {
    return this.currentStage;
  }

  public get frameIndex(): number {
    const clip = this.definition.clips[this.currentStage];
    return Math.min(clip.frameCount - 1, Math.floor(this.stageElapsedMs / clip.frameDurationMs));
  }

  public setDesiredWorking(desiredWorking: boolean): void {
    this.desiredWorking = desiredWorking;
    if (desiredWorking && this.holdingCloseIdle) {
      this.holdingCloseIdle = false;
      this.currentStage = "open";
      this.stageElapsedMs = 0;
    }
  }

  /** seek 落点或离屏恢复可直接收敛到稳定阶段；普通启用仍完整播放开启序列。 */
  public reset(desiredWorking: boolean, stable = false): void {
    this.desiredWorking = desiredWorking;
    this.currentStage = desiredWorking ? (stable ? "open_idle" : "open") : "close_idle";
    this.holdingCloseIdle = stable && !desiredWorking && this.definition.closeIdleMode === "hold-last";
    this.stageElapsedMs = this.holdingCloseIdle ? this.definition.clips.close_idle.durationMs : 0;
  }

  /** 调用者在暂停或 seek 中不推进时间；无效时钟差不能污染已冻结的进度。 */
  public advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || this.holdingCloseIdle) {
      return;
    }

    let remainingMs = deltaMs;
    while (remainingMs > 0) {
      const clip = this.definition.clips[this.currentStage];
      const untilBoundaryMs = clip.durationMs - this.stageElapsedMs;
      if (remainingMs < untilBoundaryMs) {
        this.stageElapsedMs += remainingMs;
        return;
      }

      remainingMs -= untilBoundaryMs;
      this.stageElapsedMs = 0;

      // 这里只跨越命名阶段的边界；稳定 idle 直接取模，不逐帧或逐轮补播。
      switch (this.currentStage) {
        case "open":
          this.currentStage = "open_idle";
          break;
        case "open_idle":
          if (this.desiredWorking) {
            this.stageElapsedMs = remainingMs % clip.durationMs;
            return;
          }
          this.currentStage = "close";
          break;
        case "close":
          this.currentStage = "close_idle";
          break;
        case "close_idle":
          if (this.desiredWorking) {
            this.currentStage = "open";
          } else if (this.definition.closeIdleMode === "loop") {
            this.stageElapsedMs = remainingMs % clip.durationMs;
            return;
          } else {
            this.holdingCloseIdle = true;
            this.stageElapsedMs = clip.durationMs;
            return;
          }
          break;
      }
    }
  }
}
