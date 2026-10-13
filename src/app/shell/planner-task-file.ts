import type { BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";

/** 解析和等价压缩在一次性 Worker 完成；主线程只接收小型共享对象图。 */
export async function readPlannerTaskFile(file: Blob, registry: RegistryContract): Promise<BlueprintPlannerTaskFile> {
  const worker = new Worker(new URL("./planner-task-file-worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<BlueprintPlannerTaskFile>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ value?: BlueprintPlannerTaskFile; error?: string }>) => {
        if (event.data.error !== undefined) reject(new Error(event.data.error));
        else if (event.data.value === undefined) reject(new Error("任务文件格式无效。"));
        else resolve(event.data.value);
      };
      worker.onerror = event => reject(new Error(`读取计算任务失败：${event.message}`));
      worker.onmessageerror = () => reject(new Error("计算任务解析结果无法读取。"));
      worker.postMessage({ file, itemIds: registry.itemDefinitions.map(item => item.id) });
    });
  } finally { worker.terminate(); }
}
