import type { RegistryContract } from "./domain/registry";
import { createRegistryContract } from "./registry";
import { cancelPlannerWorkerRequest, runPlannerWorkerRequest } from "./blueprint-planner/worker-runtime";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./blueprint-planner/worker-protocol";

// 独立运行环境的组合根；业务模块之间仍只通过 Domain 通信。
let registry: RegistryContract | undefined;
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<PlannerWorkerRequest | { id: number; cancel: true }>) => void;
  postMessage(response: PlannerWorkerResponse): void;
};
scope.onmessage = (event) => {
  if ("cancel" in event.data) { cancelPlannerWorkerRequest(event.data.id); return; }
  const request = event.data;
  try {
    registry ??= createRegistryContract(request.registrySnapshot);
    void runPlannerWorkerRequest(registry, request, (response) => scope.postMessage(response));
  } catch (error) {
    scope.postMessage({
      id: request.id,
      type: "failed",
      kind: "fatal",
      message: error instanceof Error ? error.message : String(error),
      evaluations: 0,
    });
  }
};
