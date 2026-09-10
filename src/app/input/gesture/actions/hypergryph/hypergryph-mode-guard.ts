// AI-REMOVED 2026-09-10:
// Reason: 操作模式总开关已废弃，不再保留关闭分支
// Trigger: 用户要求彻底移除 hypergryphOperationMode。
// Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
// Replacement: gesture-action-router.ts 的默认启用语义
// Risk: 历史 false 设置统一使用当前操作行为。
// Human Review: Required
//
// Original code:
// import type { AppHost } from "@/app/host/app-host";
// import type { GestureActionContext } from "../types";
//
// export function isHypergryphGestureEnabled(
//   context: GestureActionContext<AppHost>,
// ): boolean {
//   return context.appHost.state.settings.hypergryphOperationMode;
// }
