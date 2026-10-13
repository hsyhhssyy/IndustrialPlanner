import type { BlueprintPlannerAreaPoint, BlueprintPlannerProgress } from "@/domain/blueprint-planner";

/** 初始基准仅为绘图参考；不写入已验证面积历史，也不把旧任务的当前最优补成零点。 */
export function plannerAreaCurvePoints(history: readonly BlueprintPlannerAreaPoint[], initialArea: number | undefined) {
  const points = history.map(point => ({ evaluatedProposals: point.evaluatedProposals, area: point.bestArea, verified: true }));
  if (initialArea !== undefined && (points[0]?.evaluatedProposals !== 0 || points[0].area !== initialArea)) {
    points.unshift({ evaluatedProposals: 0, area: initialArea, verified: false });
  }
  return points;
}

interface ProposalRateSample {
  readonly taskId: string;
  readonly roundStart: number;
  readonly proposals: number;
  readonly elapsedMs: number;
  readonly rate: number | null;
}

/** 有效计算时长按天、小时、分、秒展示，最低保留分和秒。 */
export function formatPlannerElapsed(elapsedMs: number, units: readonly [string, string, string, string]): string {
  const total = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  const days = Math.floor(total / 86400), hours = Math.floor(total / 3600) % 24;
  return `${days ? `${days}${units[0]}` : ""}${days || hours ? `${hours}${units[1]}` : ""}${Math.floor(total / 60) % 60}${units[2]}${total % 60}${units[3]}`;
}

export function plannerProposalRate(proposals: number, elapsedMs: number): number {
  return elapsedMs > 0 ? Math.round(proposals * 1000 / elapsedMs) : 0;
}

/** 仅保留一个约两秒的采样基点；有效计算时间不包含暂停间隔。 */
export function samplePlannerProposalRate(previous: ProposalRateSample | null,
  progress: Pick<BlueprintPlannerProgress, "taskId" | "status" | "evaluatedProposals" | "roundEvaluatedProposals" | "elapsedMs"> | null,
): ProposalRateSample | null {
  if (!progress) return null;
  const roundStart = progress.evaluatedProposals - progress.roundEvaluatedProposals;
  const current = { taskId: progress.taskId, roundStart, proposals: progress.evaluatedProposals,
    elapsedMs: progress.elapsedMs, rate: null };
  if (progress.status !== "running") return { ...current, rate: 0 };
  if (!previous || previous.taskId !== current.taskId || previous.roundStart !== roundStart
    || previous.proposals > current.proposals || previous.elapsedMs > current.elapsedMs) return current;
  const duration = current.elapsedMs - previous.elapsedMs;
  if (duration < 2000) return previous;
  return { ...current, rate: plannerProposalRate(current.proposals - previous.proposals, duration) };
}

/** log(1 + value) 保留零点；刻度和曲线共用同一映射，反向范围用于 Y 轴。 */
// AI-CORRECTION 2026-10-03: 用户确认只有 X 轴采用对数；Y 轴由 plannerAreaCoordinate 线性映射。
// AI-CORRECTION 2026-10-05: X 轴按首个面积记录到累计提案的范围缩放；正数范围使用 log(x)，真实零记录使用 log(1+x)，单一 X 值居中。
export function plannerLogCoordinate(value: number, minimum: number, maximum: number, start: number, end: number): number {
  if (minimum === maximum) return (start + end) / 2;
  const base = minimum > 0 ? minimum : 1;
  return start + Math.log1p((value - minimum) / base) / Math.log1p((maximum - minimum) / base) * (end - start);
}

/** 面积按实际极值线性缩放并留白；只有一个面积值时保持在图表中间。 */
export function plannerAreaCoordinate(value: number, minimum: number, maximum: number, top: number, bottom: number): number {
  const padding = Math.max(1, (maximum - minimum) * 0.1);
  const lower = Math.max(0, minimum - padding), upper = maximum + padding;
  return bottom - (value - lower) / (upper - lower) * (bottom - top);
}

/** 保持真实线性 X 坐标；重叠的刻度文字换行，不丢弃任何面积下降点。 */
// AI-CORRECTION 2026-10-03: 用户改为合并连续密集下降的标签，仅保留最后一次；曲线数据不变。
// AI-CORRECTION 2026-10-03: 两轴改用 log(1+x)；必须保留零刻度，密集下降仍仅保留最后一次。
// AI-CORRECTION 2026-10-03: 用户最终选择 X 对数、Y 线性；本函数只负责 X 轴。
// AI-CORRECTION 2026-10-05: 不再强制零刻度；首个面积记录作为起点，最后一个可见刻度保留完整数字，其余使用 K/M。
export function plannerAreaTicks(points: readonly BlueprintPlannerAreaPoint[], proposals: number, left: number, right: number) {
  const values = new Set<number>();
  let bestArea = Infinity;
  for (const point of points) {
    if (point.bestArea < bestArea) {
      values.add(point.evaluatedProposals);
      bestArea = point.bestArea;
    }
  }
  // AI-REMOVED 2026-10-03:
  // Reason: 密集标签改为合并，不再增加标签行数。Trigger: 用户要求连续快速下降只显示最后一个坐标。
  // Evidence: 原实现保留每个下降刻度并错行。Replacement: 下方相邻标签合并，下降坐标优先于轴端点。
  // Risk: 较早的密集下降次数不再直接显示于轴上，仍可从曲线圆点查看。Human Review: Required
  // Original code:
  // const rowEnds: number[] = [];
  // return [...values].sort((a, b) => a - b).map(value => {
  //   const x = left + value / Math.max(1, proposals) * (right - left);
  //   const label = value.toLocaleString();
  //   const labelWidth = label.length * 7;
  //   const labelX = Math.max(left, Math.min(right - labelWidth, x - labelWidth / 2));
  //   let row = rowEnds.findIndex(end => end + 10 <= labelX);
  //   if (row === -1) row = rowEnds.length;
  //   rowEnds[row] = labelX + labelWidth;
  //   return { value, x, label, labelX, row };
  // });
  const minimum = points[0]?.evaluatedProposals ?? proposals;
  const maximum = Math.max(minimum, proposals);
  const orderedValues = [...values].sort((a, b) => a - b);
  const lastValue = orderedValues.at(-1) ?? minimum;
  const createTick = (value: number, exact = value === lastValue) => {
    const x = plannerLogCoordinate(value, minimum, maximum, left, right);
    const unit = value >= 1_000_000 ? 1_000_000 : value >= 1000 ? 1000 : 1;
    const label = exact || unit === 1 ? value.toLocaleString()
      : `${(value / unit).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit === 1000 ? "K" : "M"}`;
    const labelWidth = label.length * 7;
    const labelX = Math.max(left, Math.min(right - labelWidth, x - labelWidth / 2));
    return { value, x, label, labelX, labelWidth };
  };
  const ticks: ReturnType<typeof createTick>[] = [createTick(minimum)];
  for (const value of orderedValues) {
    if (value === minimum) continue;
    const tick = createTick(value);
    if (tick.labelX < ticks[0]!.labelX + ticks[0]!.labelWidth + 10) continue;
    while (ticks.length > 1 && ticks.at(-1)!.labelX + ticks.at(-1)!.labelWidth + 10 > tick.labelX) ticks.pop();
    ticks.push(tick);
  }
  // AI-REMOVED 2026-10-05:
  // Reason: 轴端点不再固定包含零，最终可见刻度必须保留完整数值。
  // Trigger: 用户要求从实际记录起点绘图，并缩写最后一个以外的刻度。
  // Evidence: 固定零点压缩高提案区间，完整中间标签导致大量合并。
  // Replacement: minimum 起点及下方累计提案端点尝试；重叠时优先最后一个下降点。
  // Risk: Low；坐标自适应后续算会改变已有点的屏幕位置。Human Review: Required
  // Original code:
  // for (const value of new Set([0, proposals])) {
  //   const tick = createTick(value);
  //   if (ticks.every(other => tick.labelX >= other.labelX + other.labelWidth + 10
  //     || other.labelX >= tick.labelX + tick.labelWidth + 10)) ticks.push(tick);
  // }
  if (proposals > lastValue) {
    const tick = createTick(proposals, true);
    const compactTicks = ticks.map(other => createTick(other.value, false));
    if (compactTicks.every(other => tick.labelX >= other.labelX + other.labelWidth + 10)) {
      ticks.splice(0, ticks.length, ...compactTicks, tick);
    }
  }
  return ticks.sort((a, b) => a.value - b.value);
}

export function shouldWarnPlannerConcurrency(concurrency: number, hardwareConcurrency: number | undefined): boolean {
  return Number.isSafeInteger(concurrency) && concurrency > 2
    && hardwareConcurrency !== undefined && Number.isSafeInteger(hardwareConcurrency) && hardwareConcurrency > 0
    && concurrency > hardwareConcurrency - 2;
}
