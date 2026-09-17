import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SimulationBlueprintRunReport } from "@/domain/simulation";
import type { PlannerSupplyAudit } from "./supply-audit";

export function meetsOperatingLimits(audit: PlannerSupplyAudit, report: SimulationBlueprintRunReport): boolean {
  return audit.operatingLimits.every(limit => {
    const measured = report.probes.find(probe => probe.id === `operating:${limit.entityId}`)?.perMinute;
    return measured !== undefined && Number.isFinite(measured) && measured >= 0 && measured <= limit.perMinute + 1e-6;
  });
}

export function meetsProductionTargets(request: BlueprintPlannerRequest, report: SimulationBlueprintRunReport): boolean {
  if (report.status !== "completed" || report.observationSeconds <= 0
    || report.diagnostics.some((entry) => entry.severity === "error")
    || report.deviceStatuses.some((entry) => entry.status === "not-in-power-net" || entry.status === "no-power")) return false;
  return request.plan.targets.every((target) => (report.probes.find((probe) => probe.id === target.itemId)?.perMinute ?? 0) + 1e-6 >= target.perMinute);
}
