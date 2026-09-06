/** 单张 WebP 精灵表的等时网格声明；省略帧时长时使用 100ms。 */
export interface DeviceSpriteAnimationClipDefinition {
  readonly rows: number;
  readonly columns: number;
  readonly frameDurationMs?: number;
}

/** 可选设备展示能力，不包含任何运行态或设备实例状态。 */
export interface DeviceSpriteAnimationDefinition {
  readonly clips: {
    readonly open: DeviceSpriteAnimationClipDefinition;
    readonly open_idle: DeviceSpriteAnimationClipDefinition;
    readonly close: DeviceSpriteAnimationClipDefinition;
    readonly close_idle: DeviceSpriteAnimationClipDefinition;
  };
  readonly closeIdleMode: "loop" | "hold-last";
}
