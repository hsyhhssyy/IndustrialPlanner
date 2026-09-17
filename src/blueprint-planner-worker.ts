import { createRegistryContract } from "./registry";
import { runPlannerWorkerRequest } from "./blueprint-planner/worker-runtime";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./blueprint-planner/worker-protocol";

// 独立运行环境的组合根；业务模块之间仍只通过 Domain 通信。
const registry = createRegistryContract();
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<PlannerWorkerRequest>) => void;
  postMessage(response: PlannerWorkerResponse): void;
};
scope.onmessage = (event) => {
  void runPlannerWorkerRequest(registry, event.data, (response) => scope.postMessage(response));
};
