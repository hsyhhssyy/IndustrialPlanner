import type { AudioAction } from "./audio-action";

export interface AudioContract {
  readonly actions: AudioAction;
  /** 幂等释放运行时资源；销毁后旧动作引用失效。 */
  destroy(): void;
}
