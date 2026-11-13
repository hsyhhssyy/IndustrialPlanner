/** 同一 clockId 的单调累计时间，不是帧差值。 */
export interface SceneTimeSample {
  readonly clockId: string;
  readonly timeMs: number;
}

export type SceneTimePolicy =
  | { readonly kind: "fixed"; readonly sampleTimeMs: number }
  | { readonly kind: "advancing"; readonly clockId: string; readonly initialTimeMs: number };
