import { parentPort, threadId } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

// 2026-10-06：Windows 上 URL.pathname 前缀斜杠会被 tsx 拼成盘符重复路径（F:\F:\...），必须用 fileURLToPath。
register({ tsconfig: fileURLToPath(new URL("../../../tsconfig.app.json", import.meta.url)) });
const { createRegistryContract } = await import("../../registry/index.ts");
const { cancelPlannerWorkerRequest, runPlannerWorkerRequest } = await import("../../blueprint-planner/worker-runtime.ts");
const registry = createRegistryContract();
parentPort.on("message", (request) => {
  if (request.cancel) { cancelPlannerWorkerRequest(request.id); return; }
  void runPlannerWorkerRequest(registry, request, (response) => parentPort.postMessage({ ...response, threadId }));
});
