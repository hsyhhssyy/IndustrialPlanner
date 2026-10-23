/** 让取消消息有机会执行；浏览器原生调度避免嵌套零延迟计时器的强制等待。 */
export function yieldPlannerTask(): Promise<void> {
  // Search-First 2026-10-13：项目没有任务让出抽象；Adopt 原生 Scheduler，Node 与旧浏览器保留既有计时器。
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  // AI-CORRECTION 2026-10-23：Node原生setImmediate可让出事件循环，无需每次支付零延迟计时器的最小等待。
  // 保留原生Scheduler优先，浏览器没有setImmediate时继续使用原计时器。
  if (scheduler?.yield) return scheduler.yield();
  const immediate = (globalThis as typeof globalThis & { setImmediate?: (callback: () => void) => unknown }).setImmediate;
  if (immediate) return new Promise<void>(resolve => { immediate(resolve); });
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}
