// AI-REMOVED 2026-09-17:
// Reason: 离线常驻训练和测试共用执行器，运行脚本不得反向引用测试实现。
// Trigger: 用户确认 CPU 多核训练及 20% 资源余量。
// Evidence: 原训练逐候选启动 Vitest，复用入口位于 tests。
// Replacement: src/scripts/eda/node-worker.mjs
// Risk: 导入入口迁移，须回归真实 Worker 与 Dense。
// Human Review: Required
//
// Original code:
// import { parentPort, threadId } from "node:worker_threads";
// import { URL } from "node:url";
// import { register } from "tsx/esm/api";
// 
// register({ tsconfig: new URL("../../../tsconfig.app.json", import.meta.url).pathname });
// const { createRegistryContract } = await import("../../registry/index.ts");
// const { runPlannerWorkerRequest } = await import("../../blueprint-planner/worker-runtime.ts");
// const registry = createRegistryContract();
// parentPort.on("message", (request) => {
//   void runPlannerWorkerRequest(registry, request, (response) => parentPort.postMessage({ ...response, threadId }));
// });
