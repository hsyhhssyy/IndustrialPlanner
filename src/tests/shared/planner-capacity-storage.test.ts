import { beforeEach, expect, it, vi } from "vitest";
import type { PlannerCapacityReport } from "@/blueprint-planner/capacity-calibration";
import { loadPlannerCapacity, plannerCapacitySignature, resolveCalibratedWorkers, savePlannerCapacity } from "@/shared/storage";

const REPORT: PlannerCapacityReport = {
  measuredAt: 1_760_000_000_000,
  hardware: { hardwareConcurrency: 28, deviceMemory: 8 },
  conservativeLimit: 32,
  points: [{ workers: 1, evaluations: 3_521, windowMs: 4_000, evaluationsPerSecond: 880.25, gain: 1, lagMs: 3 }],
  concurrentWorkers: 27,
  notes: ["已测到 27 档仍持续增益"],
};

beforeEach(() => { localStorage.clear(); });

it("按硬件签名保存与读取标定结果", () => {
  expect(loadPlannerCapacity()).toBeNull();
  const signature = plannerCapacitySignature(28, 8);
  expect(signature).toBe("28c/8g");
  savePlannerCapacity({ signature, report: REPORT });
  expect(loadPlannerCapacity()).toEqual({ signature, report: REPORT });
  expect(resolveCalibratedWorkers(signature)).toBe(27);
});

it("签名不一致时不套用别的机器的容量结论", () => {
  const stored = plannerCapacitySignature(28, 8);
  savePlannerCapacity({ signature: stored, report: REPORT });
  // 另一台机器（不同核数或不同 deviceMemory 量化值）必须回退到未标定。
  expect(resolveCalibratedWorkers(plannerCapacitySignature(8, 8))).toBeUndefined();
  expect(resolveCalibratedWorkers(plannerCapacitySignature(28, 4))).toBeUndefined();
  expect(resolveCalibratedWorkers(plannerCapacitySignature(undefined, undefined))).toBeUndefined();
});

it("存档损坏或字段缺失时按未标定处理", () => {
  localStorage.setItem("v3-planner-capacity", "{");
  expect(loadPlannerCapacity()).toBeNull();
  localStorage.setItem("v3-planner-capacity", JSON.stringify({ signature: "28c/8g", report: { concurrentWorkers: 1.5 } }));
  expect(loadPlannerCapacity()).toBeNull();
});

it("标定过程中写存档失败不抛出", () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
  expect(() => savePlannerCapacity({ signature: "28c/8g", report: REPORT })).not.toThrow();
  setItem.mockRestore();
});
