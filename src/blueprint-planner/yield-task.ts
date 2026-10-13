/** 让取消消息有机会执行；浏览器原生调度避免嵌套零延迟计时器的强制等待。 */
export function yieldPlannerTask(): Promise<void> {
  // Search-First 2026-10-13：项目没有任务让出抽象；Adopt 原生 Scheduler，Node 与旧浏览器保留既有计时器。
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise<void>(resolve => setTimeout(resolve, 0));
}
