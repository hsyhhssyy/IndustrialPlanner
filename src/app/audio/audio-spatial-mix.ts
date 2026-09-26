// AI-REMOVED 2026-09-26:
// Reason: 音效运行时提取为独立 Audio 模块，App 仅保留 UI 与真实手势入口。
// Trigger: 用户授权模块重构并逐项确认 AudioAction、AudioContract 和 WorkspaceContract.audio。
// Evidence: 原 AppHost 持有控制器，WorkbenchApp effect 管理播放订阅生命周期。
// Replacement: src/audio/audio-spatial-mix.ts；旧文件仅作审计归档，不再导出活动实现。
// Risk: 需验证手势解锁、单实例生命周期及销毁后的迟到任务。
// Human Review: Required
// Original code:
// import type { GridRect } from "@/domain/shared/grid";
// import { areGridRectsIntersecting } from "@/shared/geometry/power-range";
//
// interface AudioPosition { readonly entity: { readonly id: string }; readonly rect: GridRect }
// interface RankedDevice { readonly id: string; readonly distance: number }
//
// /** 屏内最近 10 台原音量；余下最近 10 台为 20%，屏外设备只进入后者。 */
// export function selectDeviceAudioGains(devices: readonly AudioPosition[], viewport: GridRect): Map<string, number> {
//   const foreground: RankedDevice[] = [], nearest: RankedDevice[] = [];
//   const x = viewport.x + viewport.width / 2, y = viewport.y + viewport.height / 2;
//   for (const { entity, rect } of devices) {
//     const candidate = { id: entity.id, distance: (rect.x + rect.width / 2 - x) ** 2 + (rect.y + rect.height / 2 - y) ** 2 };
//     if (areGridRectsIntersecting(viewport, rect)) insertNearest(foreground, candidate, 10);
//     insertNearest(nearest, candidate, 20);
//   }
//   const gains = new Map(foreground.map(({ id }) => [id, 1]));
//   let quiet = 0;
//   for (const { id } of nearest) {
//     if (gains.has(id)) continue;
//     gains.set(id, 0.2);
//     if (++quiet === 10) break;
//   }
//   return gains;
// }
//
// function insertNearest(list: RankedDevice[], candidate: RankedDevice, limit: number): void {
//   // 固定大小的候选列表避免每次视口刷新对整个基地排序；同距以 ID 保持稳定。
//   const index = list.findIndex((entry) => candidate.distance < entry.distance
//     || (candidate.distance === entry.distance && candidate.id < entry.id));
//   if (index === -1) {
//     if (list.length < limit) list.push(candidate);
//   } else {
//     list.splice(index, 0, candidate);
//     if (list.length > limit) list.pop();
//   }
// }
