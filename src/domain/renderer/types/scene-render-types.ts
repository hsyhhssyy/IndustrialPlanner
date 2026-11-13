import type { SceneViewInput } from "../../document/scene-view-input";
import type { SceneTimePolicy, SceneTimeSample } from "../../shared/scene-time";
export type { SceneTimePolicy, SceneTimeSample } from "../../shared/scene-time";

export type RenderViewHandle = string;

export interface MountSceneViewOptions {
  readonly input: SceneViewInput;
  readonly time: SceneTimePolicy;
  readonly signal?: AbortSignal;
}

export interface SceneViewUpdate {
  readonly handle: RenderViewHandle;
  readonly sample?: SceneTimeSample;
}

export interface RenderViewStatus {
  readonly phase: "initializing" | "ready" | "suspended" | "disposed";
  readonly sampleTimeMs: number;
  readonly dirty: boolean;
  readonly needsContinuousFrame: boolean;
}
