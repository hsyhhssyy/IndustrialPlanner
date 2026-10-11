import type { SimulationBlueprintProbe, SimulationBlueprintRunReport } from "@/domain/simulation";

const SUBMISSION_PROBE_PREFIX = "stash-submit:";

/** 独立标记自动入仓终点，物理输出探针不冒充仓库提交计数。 */
export function stashSubmissionProbe(entityId: string, itemId: string): SimulationBlueprintProbe {
  return { id: `${SUBMISSION_PROBE_PREFIX}${entityId}`, entityIds: [entityId], itemId, direction: "output" };
}

/** 流入量只有在箱子实际运行提交配方、库存有限且已覆盖提交周期时才能作为持续产出。 */
export function meetsStashSubmission(report: SimulationBlueprintRunReport): boolean {
  return report.probes.filter(probe => probe.id.startsWith(SUBMISSION_PROBE_PREFIX)).every(probe => {
    const entityId = probe.id.slice(SUBMISSION_PROBE_PREFIX.length);
    const channel = report.analysis?.channels.find(channel => channel.entityId === entityId && channel.channelId === "warehouse_submit");
    return report.observationSeconds >= 10 && channel?.configuredRecipeId === "r_warehouse_submit"
      && channel.observedRecipeIds.includes("r_warehouse_submit")
      && report.analysis!.slots.filter(slot => slot.entityId === entityId).every(slot => !slot.infinite)
      && report.deviceStatuses.some(device => device.entityId === entityId
        && device.status !== "not-in-power-net" && device.status !== "no-power");
  });
}
