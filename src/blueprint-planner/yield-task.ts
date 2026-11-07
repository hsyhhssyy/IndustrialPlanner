/** 让取消消息有机会执行；浏览器原生调度避免嵌套零延迟计时器的强制等待。 */
export function yieldPlannerTask(): Promise<void> {
  // Search-First 2026-10-13：项目没有任务让出抽象；Adopt 原生 Scheduler，Node 与旧浏览器保留既有计时器。
  // AI-CORRECTION 2026-11-06：yield 的提升优先级会饿死 Worker 取消消息；后台普通任务保留无计时器等待并让消息先执行。
  const scheduler = (globalThis as typeof globalThis & { scheduler?: {
    postTask?: (callback: () => void, options: { priority: "background" }) => Promise<void>;
  } }).scheduler;
  return scheduler?.postTask ? scheduler.postTask(() => undefined, { priority: "background" })
    : new Promise<void>(resolve => setTimeout(resolve, 0));
  // AI-REMOVED 2026-11-06:
  // Reason: 连续原生 yield 使协作取消消息长期得不到处理。
  // Trigger: 模块布线首解后取消结算超过二十分钟。
  // Evidence: Windows cancel-probe：原策略 41.9s 未收到取消；后台 postTask 11.7ms 收到、17.7ms 结算。
  // Replacement: 上方普通后台任务；旧环境保留计时器回退。
  // Risk: 繁忙环境会优先处理其他消息；搜索计费和随机提案逻辑不变。
  // Human Review: Required
  // Original code:
  // const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  // return scheduler?.yield ? scheduler.yield() : new Promise<void>(resolve => setTimeout(resolve, 0));
}

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 6a62e0a6cc484d97390fb435aaeeef6dff8b798244081e656632a6f94b8f189a。
// Replacement: src/blueprint-planner/yield-task.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/yield-task.ts):
// /** 让取消消息有机会执行；浏览器原生调度避免嵌套零延迟计时器的强制等待。 */
// export function yieldPlannerTask(): Promise<void> {
//   // Search-First 2026-10-13：项目没有任务让出抽象；Adopt 原生 Scheduler，Node 与旧浏览器保留既有计时器。
//   const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
//   // AI-CORRECTION 2026-10-23：Node原生setImmediate可让出事件循环，无需每次支付零延迟计时器的最小等待。
//   // 保留原生Scheduler优先，浏览器没有setImmediate时继续使用原计时器。
//   if (scheduler?.yield) return scheduler.yield();
//   const immediate = (globalThis as typeof globalThis & { setImmediate?: (callback: () => void) => unknown }).setImmediate;
//   if (immediate) return new Promise<void>(resolve => { immediate(resolve); });
//   return new Promise<void>(resolve => setTimeout(resolve, 0));
// }
//
