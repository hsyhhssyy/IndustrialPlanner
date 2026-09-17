import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createPlannerCandidate } from "./candidate";
import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./worker-protocol";

/** 浏览器与 Node 测试使用同一消息处理器，Registry 仅由各自组合根注入。 */
export async function runPlannerWorkerRequest(
  registry: RegistryContract, input: PlannerWorkerRequest, send: (response: PlannerWorkerResponse) => void,
): Promise<void> {
  const deadline = performance.now() + input.budgetMs;
  let lastUpdate = -Infinity;
  try {
    const candidate = await createPlannerCandidate(registry, input.request, input.variant, () => {
      if (performance.now() >= deadline) throw new PlanningBudgetExhausted();
    }, (phase, message) => {
      if (performance.now() - lastUpdate < 100) return;
      lastUpdate = performance.now();
      send({ id: input.id, type: "progress", phase, message });
    }, input.search);
    send({ id: input.id, type: "completed", candidate });
  } catch (error) {
    send({ id: input.id, type: "failed",
      kind: error instanceof PlanningBudgetExhausted ? "timeout" : error instanceof PlannerCandidateError ? "candidate" : "fatal",
      message: error instanceof Error ? error.message : String(error),
      search: error instanceof PlannerCandidateError ? error.search : undefined,
    });
  }
}
