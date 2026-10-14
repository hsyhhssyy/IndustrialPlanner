import { PlannerGpuLayout } from "./gpu-layout";
import { PlannerGpuLayoutQueue } from "./gpu-layout-channel";

// 独立 GPU 数值执行环境，不创建 Registry 或任何布局搜索状态。
const queue = new PlannerGpuLayoutQueue(new PlannerGpuLayout());
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<{ id: number; port?: MessagePort }>) => void };
scope.onmessage = ({ data }) => {
  if (data.port) queue.attach(data.id, data.port);
  else queue.detach(data.id);
};
