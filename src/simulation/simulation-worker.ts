import { createRegistryContract } from "@/registry";
import { SimulationWorkerRuntime } from "./worker-runtime";
import type {
  SimulationWorkerErrorNotification,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

const registry = createRegistryContract();
const runtime = new SimulationWorkerRuntime(registry);
const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SimulationWorkerRequest>) => void,
  ): void;
  postMessage(response: SimulationWorkerResponse | SimulationWorkerErrorNotification): void;
};

// 异步路径（setTimeout 回调中的 fillOneTick/advanceToTick）错误时主动推送到主线程
runtime.setOnError((error, tickNumber) => {
  workerScope.postMessage({
    type: "worker-error",
    error,
    tickNumber,
  });
});

workerScope.addEventListener("message", (event: MessageEvent<SimulationWorkerRequest>) => {
  try {
    const response: SimulationWorkerResponse = runtime.handleRequest(event.data);
    workerScope.postMessage(response);
  } catch (error) {
    // 防御性安全网：handleRequest 已内置 try-catch，此处仅在极端异常（如 postMessage 序列化失败）时触发
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SimWorker] Unhandled error in message handler: ${message}`);
  }
});
