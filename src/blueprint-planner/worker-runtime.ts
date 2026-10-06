import type { BlueprintPlannerPhase } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createPlannerCandidate } from "./candidate";
import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./worker-protocol";
import type { PlannerGpuRouting } from "./gpu-routing";

const cancellations = new Set<number>();
let gpuRouting: PlannerGpuRouting | undefined;
let gpuLoadError: string | undefined;
export function cancelPlannerWorkerRequest(id: number): void { cancellations.add(id); }

/** 浏览器与 Node 测试使用同一消息处理器，Registry 仅由各自组合根注入。 */
export async function runPlannerWorkerRequest(
  registry: RegistryContract, input: PlannerWorkerRequest, send: (response: PlannerWorkerResponse) => void,
): Promise<void> {
  const deadline = input.budgetMs === null ? Infinity : performance.now() + input.budgetMs;
  let lastUpdate = -Infinity, evaluations = 0;
  let currentPhase: BlueprintPlannerPhase = "preparing", currentMessage = "正在准备布局";
  const progress = () => {
    if (performance.now() - lastUpdate < 100) return;
    lastUpdate = performance.now();
    send({ id: input.id, type: "progress", phase: currentPhase, message: currentMessage, evaluations });
  };
  try {
    // 只在 Host 分配的一个混合通道加载 WebGPU；Node 和单 Worker 入口保持纯 CPU。
    if (input.gpu && !gpuRouting && !gpuLoadError) {
      try {
        const { PlannerGpuRouting } = await import("./gpu-routing");
        gpuRouting = new PlannerGpuRouting();
        // 2026-10-06：交叉规模由主机标定给出。缺省值高于真实线路包围盒，不写入的话 GPU 永远不被选中。
        if (input.gpuCrossoverCells !== undefined) gpuRouting.applyMeasurement({ maxProfitableCells: input.gpuCrossoverCells });
      } catch (error) {
        // 可选算子加载失败不能使整个布局任务失败；本通道本轮继续使用 CPU。
        gpuLoadError = error instanceof Error ? error.message : String(error);
      }
    }
    const candidate = await createPlannerCandidate(registry, input.request, input.variant, () => {
      if (cancellations.has(input.id)) throw new DOMException("计算已暂停", "AbortError");
      if (performance.now() >= deadline) throw new PlanningBudgetExhausted();
    }, (phase, message) => {
      currentPhase = phase; currentMessage = message; progress();
    }, input.search, count => { evaluations = count; progress(); }, input.gpu ? gpuRouting : undefined);
    send({ id: input.id, type: "completed", candidate, routing: input.gpu ? gpuRouting?.metrics : undefined });
  } catch (error) {
    send({ id: input.id, type: "failed",
      kind: error instanceof PlanningBudgetExhausted ? "timeout" : error instanceof PlannerCandidateError ? "candidate" : "fatal",
      message: error instanceof Error ? error.message : String(error),
      search: error instanceof PlannerCandidateError ? error.search : undefined,
      evaluations: error instanceof PlannerCandidateError ? error.search?.evaluations ?? evaluations : evaluations,
      routing: input.gpu ? gpuRouting?.metrics : undefined,
    });
  } finally { cancellations.delete(input.id); }
}
