import type { SceneTimeSample } from "@/domain/shared/scene-time";
import { SceneClock } from "./scene-clock";

/** 每个仿真实例一个 owner；共享 owner 的重复样本不能重复推进仿真。 */
export function createPlaybackOwner(options: {
  readonly clockId: string;
  readonly isPlaying: () => boolean;
  readonly advance: (deltaMs: number) => Promise<unknown> | void;
  readonly onError?: (error: unknown) => void;
}) {
  const clock = new SceneClock({ kind: "advancing", clockId: options.clockId, initialTimeMs: 0 });
  let disposed = false;
  return {
    update(sample: SceneTimeSample): void {
      if (disposed) return;
      if (!options.isPlaying()) { clock.resetBaseline(); return; }
      const deltaMs = clock.update(sample);
      if (deltaMs <= 0) return;
      try {
        // 保留原 scheduler 的 100ms 上界；引擎继续负责速度、tick 单位及背压。
        const result = options.advance(Math.min(100, deltaMs));
        if (result !== undefined) void result.catch((error: unknown) => {
          if (!disposed) (options.onError ?? console.error)(error);
        });
      } catch (error) { (options.onError ?? console.error)(error); }
    },
    resetBaseline: (): void => clock.resetBaseline(),
    dispose(): void { disposed = true; clock.resetBaseline(); },
  };
}
