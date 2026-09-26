// AI-REMOVED 2026-09-26:
// Reason: 音效运行时提取为独立 Audio 模块，App 仅保留 UI 与真实手势入口。
// Trigger: 用户授权模块重构并逐项确认 AudioAction、AudioContract 和 WorkspaceContract.audio。
// Evidence: 原 AppHost 持有控制器，WorkbenchApp effect 管理播放订阅生命周期。
// Replacement: src/audio/index.ts；旧文件仅作审计归档，不再导出活动实现。
// Risk: 需验证手势解锁、单实例生命周期及销毁后的迟到任务。
// Human Review: Required
// Original code:
// export { DeviceAudioController } from "./device-audio-controller";
