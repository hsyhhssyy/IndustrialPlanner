import {
  type DeviceSpriteAnimationPhase,
  type NormalizedDeviceSpriteAnimationDefinition,
  resolveDeviceSpriteAnimationStatusClip,
} from "@/shared/device-sprite-animation";
import type { SimulationDeviceOperatingStatus } from "@/domain/simulation";

/** 每个可见设备独立保存播放进度；目标反转只在完整 idle 轮次结束后提交。 */
/** AI-CORRECTION 2026-09-18: 播放目标改为设备展示 status；传统四阶段只是其中一种 manifest 路由。 */
export class DeviceAnimationState {
  private readonly definition: NormalizedDeviceSpriteAnimationDefinition;
  private currentStage: DeviceSpriteAnimationPhase;
  private stageElapsedMs = 0;
  private desiredStatus: SimulationDeviceOperatingStatus;
  private holdingStableClip = false;
  private readonly savedElapsedMs = new Map<DeviceSpriteAnimationPhase, number>();

  public constructor(
    definition: NormalizedDeviceSpriteAnimationDefinition,
    desiredStatus: SimulationDeviceOperatingStatus,
    stable = false,
  ) {
    this.definition = definition;
    this.currentStage = definition.playback.fallbackClip;
    this.desiredStatus = desiredStatus;
    this.reset(desiredStatus, stable);
  }

  public get stage(): DeviceSpriteAnimationPhase {
    return this.currentStage;
  }

  public get frameIndex(): number {
    const clip = this.definition.clips[this.currentStage]!;
    // AI-REMOVED 2026-09-10:
    // Reason: 固定帧时长无法保留去重素材的逐帧停留时间。
    // Trigger: v1.5 建筑素材接入。
    // Evidence: 素材包含 30ms 至 1340ms 等不同帧时长。
    // Replacement: 下方累计结束时刻的二分查找。
    // Risk: Low；固定时长素材走同一时间表。Human Review: Required
    // Original code:
    // return Math.min(clip.frameCount - 1, Math.floor(this.stageElapsedMs / clip.frameDurationMs));
    let left = 0;
    let right = clip.frameCount - 1;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (this.stageElapsedMs < clip.frameEndTimesMs[middle]!) right = middle;
      else left = middle + 1;
    }
    return left;
  }

  public setStatus(status: SimulationDeviceOperatingStatus): void {
    if (this.desiredStatus === status) return;
    this.desiredStatus = status;
    const option = this.definition.playback.clipOptions[this.currentStage];
    if (this.holdingStableClip || option?.playing === false) this.commitStableTarget();
  }

  /** seek 落点或离屏恢复可直接收敛到稳定阶段；普通启用仍完整播放开启序列。 */
  public reset(status: SimulationDeviceOperatingStatus, stable = false): void {
    this.desiredStatus = status;
    this.savedElapsedMs.clear();
    const target = resolveDeviceSpriteAnimationStatusClip(this.definition, status);
    const openTransition = this.definition.playback.openTransitionClip;
    this.currentStage = !stable && target === this.definition.playback.statusClips.normal
      && openTransition !== null
      ? openTransition
      : target;
    const option = this.definition.playback.clipOptions[this.currentStage];
    this.holdingStableClip = option?.playing === false
      || (stable && option?.loop === false && this.currentStage === "close_idle");
    this.stageElapsedMs = this.holdingStableClip && option?.playing !== false
      ? this.definition.clips[this.currentStage]!.durationMs
      : 0;
  }

  /** 调用者在暂停或 seek 中不推进时间；无效时钟差不能污染已冻结的进度。 */
  public advance(
    deltaMs: number,
    canDisplayFrame: ((phase: DeviceSpriteAnimationPhase, frameIndex: number) => boolean) | null = null,
  ): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || this.holdingStableClip
      || this.definition.playback.clipOptions[this.currentStage]?.playing === false) {
      return;
    }

    const previousStage = this.currentStage;
    const previousElapsedMs = this.stageElapsedMs;
    const previousHoldingStableClip = this.holdingStableClip;
    this.advanceUnchecked(deltaMs);

    if (canDisplayFrame !== null && !canDisplayFrame(this.currentStage, this.frameIndex)) {
      this.currentStage = previousStage;
      this.stageElapsedMs = previousElapsedMs;
      this.holdingStableClip = previousHoldingStableClip;
    }
  }

  private advanceUnchecked(deltaMs: number): void {
    let remainingMs = deltaMs;
    while (remainingMs > 0) {
      const clip = this.definition.clips[this.currentStage]!;
      const untilBoundaryMs = clip.durationMs - this.stageElapsedMs;
      if (remainingMs < untilBoundaryMs) {
        this.stageElapsedMs += remainingMs;
        return;
      }

      remainingMs -= untilBoundaryMs;
      this.stageElapsedMs = 0;

      this.savedElapsedMs.set(this.currentStage, 0);
      if (this.currentStage === this.definition.playback.openTransitionClip) {
        this.enterClip(this.definition.playback.statusClips.normal ?? this.definition.playback.fallbackClip);
        continue;
      }
      if (this.currentStage === this.definition.playback.closeTransitionClip) {
        this.enterClip(this.definition.playback.fallbackClip);
        continue;
      }
      const target = resolveDeviceSpriteAnimationStatusClip(this.definition, this.desiredStatus);
      if (target !== this.currentStage) {
        this.commitStableTarget();
        continue;
      }
      const option = this.definition.playback.clipOptions[this.currentStage]!;
      if (option.loop) {
        this.stageElapsedMs = remainingMs % clip.durationMs;
        this.savedElapsedMs.set(this.currentStage, this.stageElapsedMs);
        return;
      }
      this.holdingStableClip = true;
      this.stageElapsedMs = clip.durationMs;
      this.savedElapsedMs.set(this.currentStage, this.stageElapsedMs);
      return;
    }
  }

  private commitStableTarget(): void {
    const target = resolveDeviceSpriteAnimationStatusClip(this.definition, this.desiredStatus);
    if (target === this.currentStage) return;
    const normalClip = this.definition.playback.statusClips.normal;
    if (this.currentStage === this.definition.playback.fallbackClip && target === normalClip
      && this.definition.playback.openTransitionClip !== null) {
      this.enterClip(this.definition.playback.openTransitionClip);
      return;
    }
    if (this.currentStage === normalClip && target === this.definition.playback.fallbackClip
      && this.definition.playback.closeTransitionClip !== null) {
      this.enterClip(this.definition.playback.closeTransitionClip);
      return;
    }
    this.enterClip(target);
  }

  private enterClip(clip: DeviceSpriteAnimationPhase): void {
    const previousOption = this.definition.playback.clipOptions[this.currentStage];
    if (previousOption?.restart === false) this.savedElapsedMs.set(this.currentStage, this.stageElapsedMs);
    this.currentStage = clip;
    const option = this.definition.playback.clipOptions[clip]!;
    const saved = option.restart ? 0 : (this.savedElapsedMs.get(clip) ?? 0);
    const duration = this.definition.clips[clip]!.durationMs;
    this.stageElapsedMs = option.loop ? saved % duration : Math.min(saved, duration);
    this.holdingStableClip = option.playing === false || (!option.loop && this.stageElapsedMs >= duration);
  }
}
