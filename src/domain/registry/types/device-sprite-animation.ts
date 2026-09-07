// AI-REMOVED 2026-09-06:
// Reason: 行列、帧数和帧时长属于分页动画素材 manifest，不属于 Registry 的设备能力声明。
// Trigger: 反应池的单阶段需要多张 WebP，原类型把一个逻辑片段错误绑定到一张满网格图片。
// Evidence: 首个真实素材的 open/open_idle/close 分别需要 23/3/17 个 4×4 页面；单页字段无法无歧义表达。
// Replacement: src/shared/device-sprite-animation.ts 的 manifest 类型与解析器。
// Risk: 旧的测试专用单页声明必须迁移到 manifest 夹具；当前没有正式设备使用旧声明。
// Human Review: Required
//
// Original code:
// /** 单张 WebP 精灵表的等时网格声明；省略帧时长时使用 100ms。 */
// export interface DeviceSpriteAnimationClipDefinition {
//   readonly rows: number;
//   readonly columns: number;
//   readonly frameDurationMs?: number;
// }

/** 可选设备展示能力，不包含任何运行态或设备实例状态。 */
export interface DeviceSpriteAnimationDefinition {
  // AI-REMOVED 2026-09-06:
  // Reason: Registry 只声明动画能力和设备级行为，不重复保存素材物理布局与播放时序。
  // Trigger: 分页、有效帧数和源片段重切分必须以生成后的 manifest 为唯一素材事实源。
  // Evidence: 同一个逻辑阶段可跨多页，rows × columns 已不再等于逻辑片段帧数。
  // Replacement: public/3d-top-view/animations/<spriteId>/manifest.json。
  // Risk: manifest 缺失或非法时整套动画原子回退到独立静态精灵。
  // Human Review: Required
  //
  // Original code:
  // readonly clips: {
  //   readonly open: DeviceSpriteAnimationClipDefinition;
  //   readonly open_idle: DeviceSpriteAnimationClipDefinition;
  //   readonly close: DeviceSpriteAnimationClipDefinition;
  //   readonly close_idle: DeviceSpriteAnimationClipDefinition;
  // };
  readonly closeIdleMode: "loop" | "hold-last";
}
