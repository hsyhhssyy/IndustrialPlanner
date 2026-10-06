import type { PlannerCapacityReport } from "@/blueprint-planner/capacity-calibration";

const STORAGE_KEY = "v3-planner-capacity";

/** 标定结果按机器签名分开保存：不同配置的机器不应互相覆盖容量结论。 */
export function plannerCapacitySignature(hardwareConcurrency: number | undefined, deviceMemory: number | undefined): string {
  return `${hardwareConcurrency ?? 0}c/${deviceMemory ?? 0}g`;
}

export interface PlannerStoredCapacity {
  readonly signature: string;
  readonly report: PlannerCapacityReport;
}

export function savePlannerCapacity(capacity: PlannerStoredCapacity): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(capacity)); } catch { /* 隐私模式或配额不足时静默降级 */ }
}

export function loadPlannerCapacity(): PlannerStoredCapacity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<PlannerStoredCapacity>;
    if (typeof parsed.signature !== "string" || !parsed.report || !Number.isSafeInteger(parsed.report.concurrentWorkers)) return null;
    return { signature: parsed.signature, report: parsed.report };
  } catch { return null; }
}

export function clearPlannerCapacity(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 同上 */ }
}

/**
 * 读取本机可用的并发上限：只有签名一致（同一台机器/同一浏览器配置）时才采用，
 * 避免把 A 机器的标定结论套到 B 机器上。
 */
export function resolveCalibratedWorkers(signature: string): number | undefined {
  const stored = loadPlannerCapacity();
  if (stored === null || stored.signature !== signature) return undefined;
  return stored.report.concurrentWorkers;
}
