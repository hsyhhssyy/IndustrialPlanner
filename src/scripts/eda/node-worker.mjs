import { parentPort, threadId } from "node:worker_threads";
import { URL } from "node:url";
import { register } from "tsx/esm/api";

register({ tsconfig: new URL("../../../tsconfig.app.json", import.meta.url).pathname });
const { createRegistryContract } = await import("../../registry/index.ts");
const { runPlannerWorkerRequest } = await import("../../blueprint-planner/worker-runtime.ts");
const registry = createRegistryContract();
parentPort.on("message", (request) => {
  void runPlannerWorkerRequest(registry, request, (response) => parentPort.postMessage({ ...response, threadId }));
});
