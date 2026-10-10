import type { BlueprintPlannerPhase } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createPlannerCandidate } from "./candidate";
import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./worker-protocol";
import { PlannerSearchSessions } from "./search-sessions";
import type { PlannerGpuLayout } from "./gpu-layout";
// AI-REMOVED 2026-10-07: 单路 GPU 布线被独立布局批次替代。
// Trigger: 实测单路往返慢于 CPU；Replacement: PlannerGpuLayout；Risk: 搜索顺序变化；Human Review: Required
// Original code:
// import type { PlannerGpuRouting } from "./gpu-routing";

const cancellations = new Set<number>();
// AI-REMOVED 2026-10-07: 同上，旧路由设备不再初始化。
// Original code: let gpuRouting: PlannerGpuRouting | undefined;
let gpuLayout: PlannerGpuLayout | undefined;
let gpuLoadError: string | undefined;
const searchSessions = new PlannerSearchSessions();
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
    // AI-REMOVED 2026-10-07:
    // Reason: 独立 GPU 分片以批量布局取代单路校准。
    // Trigger: Windows 三方向实验；Evidence: 算法探索20261007-GPU批量与独立任务。
    // Replacement: 下方 PlannerGpuLayout；Risk: 代理搜索质量需完整验收；Human Review: Required
    // Original code:
    //     // 只在 Host 分配的一个混合通道加载 WebGPU；Node 和单 Worker 入口保持纯 CPU。
    //     if (input.gpu && !gpuRouting && !gpuLoadError) {
    //       try {
    //         const { PlannerGpuRouting } = await import("./gpu-routing");
    //         gpuRouting = new PlannerGpuRouting();
    //       } catch (error) {
    //         // 可选算子加载失败不能使整个布局任务失败；本通道本轮继续使用 CPU。
    //         gpuLoadError = error instanceof Error ? error.message : String(error);
    //       }
    //     }
    if (input.gpu && !gpuLayout && !gpuLoadError) {
      try {
        const { PlannerGpuLayout } = await import("./gpu-layout");
        gpuLayout = new PlannerGpuLayout();
      } catch (error) { gpuLoadError = error instanceof Error ? error.message : String(error); }
    }
    const layoutMetrics = () => gpuLayout?.metrics ?? (gpuLoadError ? { batches: 0, evaluations: 0,
      kernelMs: 0, wallMs: 0, uploadedBytes: 0, fallbackReason: gpuLoadError } : undefined);
    const candidate = await createPlannerCandidate(registry, input.request, input.variant, () => {
      if (cancellations.has(input.id)) throw new DOMException("计算已暂停", "AbortError");
      if (performance.now() >= deadline) throw new PlanningBudgetExhausted();
    }, (phase, message) => {
      currentPhase = phase; currentMessage = message; progress();
    }, input.search, count => { evaluations = count; progress(); }, undefined, input.gpu ? gpuLayout : undefined, searchSessions);
    send({ id: input.id, type: "completed", candidate, layout: input.gpu ? layoutMetrics() : undefined });
  } catch (error) {
    send({ id: input.id, type: "failed",
      kind: error instanceof PlanningBudgetExhausted ? "timeout" : error instanceof PlannerCandidateError ? "candidate" : "fatal",
      message: error instanceof Error ? error.message : String(error),
      search: error instanceof PlannerCandidateError ? error.search : undefined,
      evaluations: error instanceof PlannerCandidateError ? error.search?.evaluations ?? evaluations : evaluations,
      layout: input.gpu ? gpuLayout?.metrics ?? { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0, fallbackReason: gpuLoadError ?? "GPU 未初始化" } : undefined,
    });
  } finally { cancellations.delete(input.id); }
}
