/** 未启动草稿以 0 表示尚未填写次数；实际执行仍使用默认的正整数准入。 */
export function assertPlannerEvaluationBudget(evaluations: number, allowZero = false): void {
  if (!Number.isSafeInteger(evaluations) || evaluations < 0 || !allowZero && evaluations === 0) {
    throw new Error("每轮计算次数必须为正安全整数。");
  }
}
